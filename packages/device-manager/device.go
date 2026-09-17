// Package devicemanager implements the HeliosLab remote device fleet: a
// registry of SSH-reachable machines plus connection lifecycle and command
// execution over an injectable transport.
//
// The core is dependency-free and cgo-free so it builds and tests everywhere.
// The concrete SSH transport lives in ssh_transport.go, and the C ABI used by
// the Bun FFI bridge lives in ./cshared.
package devicemanager

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Device connection states.
const (
	StateRegistered   = "registered"
	StateConnected    = "connected"
	StateDisconnected = "disconnected"
	StateError        = "error"
)

var (
	ErrDeviceNotFound = errors.New("device not found")
	ErrNotConnected   = errors.New("device not connected")
	ErrDuplicateName  = errors.New("device name already registered")
	ErrInvalidTarget  = errors.New("invalid target")
)

// Target describes how to reach a device.
type Target struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	KeyPath string `json:"key_path"`
}

// Addr returns the host:port pair, handling IPv6 literals correctly.
func (t Target) Addr() string {
	return net.JoinHostPort(t.Host, strconv.Itoa(t.Port))
}

// Validate reports whether the target has the minimum usable fields.
func (t Target) Validate() error {
	if strings.TrimSpace(t.Host) == "" {
		return fmt.Errorf("%w: host is empty", ErrInvalidTarget)
	}
	if strings.TrimSpace(t.User) == "" {
		return fmt.Errorf("%w: user is empty", ErrInvalidTarget)
	}
	if t.Port <= 0 || t.Port > 65535 {
		return fmt.Errorf("%w: port %d out of range", ErrInvalidTarget, t.Port)
	}
	return nil
}

// ExecResult is the outcome of a remote command.
type ExecResult struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
}

// Conn is a live connection to a device.
type Conn interface {
	Run(ctx context.Context, command string) (ExecResult, error)
	Close() error
}

// Dialer opens connections. Tests supply a fake.
type Dialer interface {
	Dial(ctx context.Context, t Target) (Conn, error)
}

// Metrics is a sampled resource snapshot for a device.
type Metrics struct {
	DeviceID    string    `json:"device_id"`
	CPUPercent  float64   `json:"cpu_percent"`
	MemPercent  float64   `json:"mem_percent"`
	DiskPercent float64   `json:"disk_percent"`
	LoadAvg1    float64   `json:"load_avg_1"`
	UptimeSecs  int64     `json:"uptime_secs"`
	SampledAt   time.Time `json:"sampled_at"`
}

// Device is one registered machine.
type Device struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Target  Target    `json:"target"`
	State   string    `json:"state"`
	LastErr string    `json:"last_error,omitempty"`
	AddedAt time.Time `json:"added_at"`

	conn Conn
}

// Manager owns the device registry. Safe for concurrent use.
type Manager struct {
	mu      sync.RWMutex
	devices map[string]*Device
	byName  map[string]string
	dialer  Dialer
	seq     uint64
	now     func() time.Time
}

// New creates a manager with the given dialer.
func New(d Dialer) *Manager {
	return &Manager{
		devices: make(map[string]*Device),
		byName:  make(map[string]string),
		dialer:  d,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// NewWithClock creates a manager with injectable time (for tests).
func NewWithClock(d Dialer, now func() time.Time) *Manager {
	m := New(d)
	if now != nil {
		m.now = now
	}
	return m
}

// Add registers a device. Names must be unique.
func (m *Manager) Add(name string, t Target) (*Device, error) {
	if err := t.Validate(); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("%w: name is empty", ErrInvalidTarget)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.byName[name]; exists {
		return nil, ErrDuplicateName
	}

	m.seq++
	d := &Device{
		ID:      fmt.Sprintf("dev-%04d", m.seq),
		Name:    name,
		Target:  t,
		State:   StateRegistered,
		AddedAt: m.now(),
	}
	m.devices[d.ID] = d
	m.byName[name] = d.ID
	return d, nil
}

// Remove unregisters a device, disconnecting it first if needed.
func (m *Manager) Remove(id string) error {
	m.mu.Lock()
	d, ok := m.devices[id]
	if !ok {
		m.mu.Unlock()
		return ErrDeviceNotFound
	}
	conn := d.conn
	d.conn = nil
	delete(m.devices, id)
	delete(m.byName, d.Name)
	m.mu.Unlock()

	if conn != nil {
		_ = conn.Close()
	}
	return nil
}

// Get returns a device by ID.
func (m *Manager) Get(id string) (*Device, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	d, ok := m.devices[id]
	if !ok {
		return nil, ErrDeviceNotFound
	}
	return d, nil
}

// GetByName returns a device by its unique name.
func (m *Manager) GetByName(name string) (*Device, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byName[name]
	if !ok {
		return nil, ErrDeviceNotFound
	}
	return m.devices[id], nil
}

// List returns devices ordered by ID for stable output.
func (m *Manager) List() []*Device {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Device, 0, len(m.devices))
	for _, d := range m.devices {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Connect dials a device and marks it connected.
func (m *Manager) Connect(ctx context.Context, id string) error {
	m.mu.Lock()
	d, ok := m.devices[id]
	if !ok {
		m.mu.Unlock()
		return ErrDeviceNotFound
	}
	if d.conn != nil {
		m.mu.Unlock()
		return nil // already connected, idempotent
	}
	dialer := m.dialer
	target := d.Target
	m.mu.Unlock()

	if dialer == nil {
		m.mu.Lock()
		d.State = StateError
		d.LastErr = "no dialer configured"
		m.mu.Unlock()
		return errors.New("no dialer configured")
	}

	conn, err := dialer.Dial(ctx, target)
	if err != nil {
		m.mu.Lock()
		d.State = StateError
		d.LastErr = err.Error()
		m.mu.Unlock()
		return err
	}

	m.mu.Lock()
	d.conn = conn
	d.State = StateConnected
	d.LastErr = ""
	m.mu.Unlock()
	return nil
}

// Disconnect closes a device connection. Safe to call when not connected.
func (m *Manager) Disconnect(id string) error {
	m.mu.Lock()
	d, ok := m.devices[id]
	if !ok {
		m.mu.Unlock()
		return ErrDeviceNotFound
	}
	conn := d.conn
	d.conn = nil
	d.State = StateDisconnected
	m.mu.Unlock()

	if conn != nil {
		return conn.Close()
	}
	return nil
}

// Exec runs a command on a connected device.
func (m *Manager) Exec(ctx context.Context, id, command string) (ExecResult, error) {
	m.mu.RLock()
	d, ok := m.devices[id]
	if !ok {
		m.mu.RUnlock()
		return ExecResult{}, ErrDeviceNotFound
	}
	conn := d.conn
	m.mu.RUnlock()

	if conn == nil {
		return ExecResult{}, ErrNotConnected
	}
	return conn.Run(ctx, command)
}

// SampleMetrics runs `uptime` on the device and parses the result.
func (m *Manager) SampleMetrics(ctx context.Context, id string) (Metrics, error) {
	res, err := m.Exec(ctx, id, "uptime")
	if err != nil {
		return Metrics{}, err
	}
	md := ParseUptime(res.Stdout)
	md.DeviceID = id
	md.SampledAt = m.now()
	return md, nil
}

// ParseUptime extracts load averages and uptime from `uptime` output.
//
// Handles both the Linux form:
//
//	12:00:00 up 3 days,  4:05,  2 users,  load average: 0.52, 0.58, 0.59
//
// and the macOS/BSD form:
//
//	12:00  up 3 days,  4:05, 2 users, load averages: 1.52 1.58 1.59
func ParseUptime(out string) Metrics {
	var md Metrics
	out = strings.TrimSpace(out)
	if out == "" {
		return md
	}

	lower := strings.ToLower(out)
	if i := strings.Index(lower, "load average"); i >= 0 {
		rest := out[i:]
		if c := strings.Index(rest, ":"); c >= 0 {
			rest = rest[c+1:]
			rest = strings.NewReplacer(",", " ").Replace(rest)
			fields := strings.Fields(rest)
			if len(fields) > 0 {
				md.LoadAvg1, _ = strconv.ParseFloat(fields[0], 64)
			}
		}
	}

	if i := strings.Index(lower, " up "); i >= 0 {
		md.UptimeSecs = parseUptimeSeconds(out[i+4:])
	}
	return md
}

// parseUptimeSeconds parses the portion of `uptime` output that follows
// " up ". That tail looks like "3 days, 4:05, 2 users, load average: ..." and
// the duration itself may span more than one comma-separated field, so we
// consume fields until we reach the user count or the load average.
func parseUptimeSeconds(tail string) int64 {
	var parts []string
	for _, seg := range strings.Split(tail, ",") {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		lseg := strings.ToLower(seg)
		if strings.Contains(lseg, "user") || strings.Contains(lseg, "load") ||
			strings.Contains(lseg, "idle") {
			break
		}
		parts = append(parts, seg)
	}
	return parseUptimeDuration(strings.Join(parts, ", "))
}

// parseUptimeDuration parses the "3 days, 4:05" / "4:05" / "12 min" fragments
// produced by uptime into seconds. Unparseable fragments return 0.
func parseUptimeDuration(s string) int64 {
	s = strings.TrimSpace(strings.ReplaceAll(s, " up ", " "))
	if s == "" {
		return 0
	}

	var total int64
	parts := strings.Split(s, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		fields := strings.Fields(p)

		// "N day[s]" / "N min[s]" / "N hr[s]"
		if len(fields) >= 2 {
			n, err := strconv.ParseInt(fields[0], 10, 64)
			if err == nil {
				switch {
				case strings.HasPrefix(fields[1], "day"):
					total += n * 86400
					continue
				case strings.HasPrefix(fields[1], "min"):
					total += n * 60
					continue
				case strings.HasPrefix(fields[1], "hr"), strings.HasPrefix(fields[1], "hour"):
					total += n * 3600
					continue
				}
			}
		}

		// "H:MM" form
		if strings.Contains(p, ":") {
			hp := strings.SplitN(p, ":", 2)
			h, err1 := strconv.ParseInt(strings.TrimSpace(hp[0]), 10, 64)
			mm, err2 := strconv.ParseInt(strings.TrimSpace(hp[1]), 10, 64)
			if err1 == nil && err2 == nil {
				total += h*3600 + mm*60
			}
		}
	}
	return total
}

// ParseProcLoadavg parses /proc/loadavg output into a Metrics with LoadAvg1
// set. Returns a zero Metrics when malformed.
func ParseProcLoadavg(out string) Metrics {
	var md Metrics
	sc := bufio.NewScanner(strings.NewReader(out))
	if !sc.Scan() {
		return md
	}
	fields := strings.Fields(sc.Text())
	if len(fields) == 0 {
		return md
	}
	md.LoadAvg1, _ = strconv.ParseFloat(fields[0], 64)
	return md
}
