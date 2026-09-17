package devicemanager

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeConn records commands and returns canned output.
type fakeConn struct {
	mu       sync.Mutex
	commands []string
	reply    ExecResult
	err      error
	closed   bool
}

func (f *fakeConn) Run(_ context.Context, cmd string) (ExecResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, cmd)
	return f.reply, f.err
}

func (f *fakeConn) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return nil
}

// fakeDialer returns a shared conn and records targets.
type fakeDialer struct {
	mu      sync.Mutex
	targets []Target
	conn    *fakeConn
	err     error
}

func (d *fakeDialer) Dial(_ context.Context, t Target) (Conn, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.targets = append(d.targets, t)
	if d.err != nil {
		return nil, d.err
	}
	if d.conn == nil {
		d.conn = &fakeConn{}
	}
	return d.conn, nil
}

func validTarget() Target {
	return Target{Host: "kooshas-laptop", Port: 22, User: "kooshapari", KeyPath: "/Users/kooshapari/.ssh/id_ed25519"}
}

func TestTargetAddr(t *testing.T) {
	cases := []struct {
		name string
		in   Target
		want string
	}{
		{"ipv4 hostname", Target{Host: "kooshas-laptop", Port: 22}, "kooshas-laptop:22"},
		{"ipv6 literal", Target{Host: "fe80::1", Port: 2222}, "[fe80::1]:2222"},
		{"fqdn", Target{Host: "dev.example.internal", Port: 2200}, "dev.example.internal:2200"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.Addr(); got != tc.want {
				t.Errorf("Addr() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTargetValidate(t *testing.T) {
	good := validTarget()
	if err := good.Validate(); err != nil {
		t.Fatalf("valid target rejected: %v", err)
	}

	bad := []struct {
		name string
		t    Target
	}{
		{"empty host", Target{Host: "", Port: 22, User: "u"}},
		{"blank host", Target{Host: "   ", Port: 22, User: "u"}},
		{"empty user", Target{Host: "h", Port: 22, User: ""}},
		{"port zero", Target{Host: "h", Port: 0, User: "u"}},
		{"port negative", Target{Host: "h", Port: -1, User: "u"}},
		{"port too high", Target{Host: "h", Port: 70000, User: "u"}},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			if err := c.t.Validate(); !errors.Is(err, ErrInvalidTarget) {
				t.Errorf("err = %v, want ErrInvalidTarget", err)
			}
		})
	}
}

func newTestManager() *Manager {
	base := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	var i int
	return NewWithClock(&fakeDialer{}, func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		i++
		return base.Add(time.Duration(i) * time.Second)
	})
}

func TestAddDevice(t *testing.T) {
	m := newTestManager()
	d, err := m.Add("laptop", validTarget())
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if d.ID != "dev-0001" {
		t.Errorf("ID = %q, want dev-0001", d.ID)
	}
	if d.State != StateRegistered {
		t.Errorf("State = %q, want %q", d.State, StateRegistered)
	}
	if d.conn != nil {
		t.Error("new device should not have a connection")
	}
}

func TestAddDeviceRejectsInvalidTarget(t *testing.T) {
	m := newTestManager()
	if _, err := m.Add("bad", Target{Host: "", Port: 22, User: "u"}); !errors.Is(err, ErrInvalidTarget) {
		t.Fatalf("err = %v, want ErrInvalidTarget", err)
	}
}

func TestAddDeviceRejectsBlankName(t *testing.T) {
	m := newTestManager()
	if _, err := m.Add("   ", validTarget()); !errors.Is(err, ErrInvalidTarget) {
		t.Fatalf("err = %v, want ErrInvalidTarget", err)
	}
}

func TestAddDeviceRejectsDuplicateName(t *testing.T) {
	m := newTestManager()
	if _, err := m.Add("laptop", validTarget()); err != nil {
		t.Fatalf("first Add: %v", err)
	}
	if _, err := m.Add("laptop", validTarget()); !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("err = %v, want ErrDuplicateName", err)
	}
}

func TestAddDeviceTrimsName(t *testing.T) {
	m := newTestManager()
	if _, err := m.Add("  laptop  ", validTarget()); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := m.GetByName("laptop"); err != nil {
		t.Fatalf("GetByName after trim: %v", err)
	}
}

func TestListOrdering(t *testing.T) {
	m := newTestManager()
	var ids []string
	for i := 0; i < 5; i++ {
		d, err := m.Add(fmt.Sprintf("dev-%d", i), validTarget())
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
		ids = append(ids, d.ID)
	}
	list := m.List()
	if len(list) != len(ids) {
		t.Fatalf("len = %d, want %d", len(list), len(ids))
	}
	for i := range ids {
		if list[i].ID != ids[i] {
			t.Fatalf("list[%d].ID = %q, want %q", i, list[i].ID, ids[i])
		}
	}
}

func TestGetAndRemove(t *testing.T) {
	m := newTestManager()
	d, _ := m.Add("laptop", validTarget())

	got, err := m.Get(d.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != d {
		t.Error("Get returned different pointer")
	}

	if err := m.Remove(d.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := m.Get(d.ID); !errors.Is(err, ErrDeviceNotFound) {
		t.Errorf("after remove err = %v, want ErrDeviceNotFound", err)
	}
	// Name must be freed for reuse.
	if _, err := m.Add("laptop", validTarget()); err != nil {
		t.Errorf("re-add after remove: %v", err)
	}
	if err := m.Remove("missing"); !errors.Is(err, ErrDeviceNotFound) {
		t.Errorf("remove missing err = %v, want ErrDeviceNotFound", err)
	}
}

func TestConnectDisconnect(t *testing.T) {
	dialer := &fakeDialer{}
	m := New(dialer)
	d, _ := m.Add("laptop", validTarget())

	if err := m.Connect(context.Background(), d.ID); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if d.State != StateConnected {
		t.Errorf("State = %q, want %q", d.State, StateConnected)
	}
	if len(dialer.targets) != 1 {
		t.Fatalf("dial count = %d, want 1", len(dialer.targets))
	}
	if dialer.targets[0].Addr() != "kooshas-laptop:22" {
		t.Errorf("dialed %q, want kooshas-laptop:22", dialer.targets[0].Addr())
	}

	// Second connect is idempotent and does not redial.
	if err := m.Connect(context.Background(), d.ID); err != nil {
		t.Fatalf("second Connect: %v", err)
	}
	if len(dialer.targets) != 1 {
		t.Errorf("dial count = %d, want 1 (idempotent)", len(dialer.targets))
	}

	if err := m.Disconnect(d.ID); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if d.State != StateDisconnected {
		t.Errorf("State = %q, want %q", d.State, StateDisconnected)
	}
	if !dialer.conn.closed {
		t.Error("connection was not closed")
	}
	// Disconnect when already disconnected is a no-op error-free call.
	if err := m.Disconnect(d.ID); err != nil {
		t.Errorf("second Disconnect: %v", err)
	}
}

func TestConnectFailureRecordsError(t *testing.T) {
	sentinel := errors.New("connection refused")
	m := New(&fakeDialer{err: sentinel})
	d, _ := m.Add("laptop", validTarget())

	err := m.Connect(context.Background(), d.ID)
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want %v", err, sentinel)
	}
	if d.State != StateError {
		t.Errorf("State = %q, want %q", d.State, StateError)
	}
	if !strings.Contains(d.LastErr, "connection refused") {
		t.Errorf("LastErr = %q, want it to mention the failure", d.LastErr)
	}
}

func TestConnectWithoutDialer(t *testing.T) {
	m := New(nil)
	d, _ := m.Add("laptop", validTarget())
	if err := m.Connect(context.Background(), d.ID); err == nil {
		t.Fatal("expected error when no dialer configured")
	}
}

func TestExecRequiresConnection(t *testing.T) {
	m := newTestManager()
	d, _ := m.Add("laptop", validTarget())

	if _, err := m.Exec(context.Background(), d.ID, "uname -a"); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v, want ErrNotConnected", err)
	}
	if _, err := m.Exec(context.Background(), "missing", "uname"); !errors.Is(err, ErrDeviceNotFound) {
		t.Fatalf("err = %v, want ErrDeviceNotFound", err)
	}
}

func TestExecForwardsCommand(t *testing.T) {
	conn := &fakeConn{reply: ExecResult{Stdout: "Darwin\n", ExitCode: 0}}
	dialer := &fakeDialer{conn: conn}
	m := New(dialer)
	d, _ := m.Add("laptop", validTarget())
	if err := m.Connect(context.Background(), d.ID); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	res, err := m.Exec(context.Background(), d.ID, "uname -s")
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}
	if res.Stdout != "Darwin\n" {
		t.Errorf("stdout = %q, want Darwin\\n", res.Stdout)
	}
	if len(conn.commands) != 1 || conn.commands[0] != "uname -s" {
		t.Errorf("commands = %v, want [uname -s]", conn.commands)
	}
}

func TestParseUptimeLinux(t *testing.T) {
	out := " 12:34:56 up 3 days,  4:05,  2 users,  load average: 0.52, 0.58, 0.59"
	md := ParseUptime(out)
	if md.LoadAvg1 != 0.52 {
		t.Errorf("LoadAvg1 = %v, want 0.52", md.LoadAvg1)
	}
	want := int64(3*86400 + 4*3600 + 5*60)
	if md.UptimeSecs != want {
		t.Errorf("UptimeSecs = %d, want %d", md.UptimeSecs, want)
	}
}

func TestParseUptimeMacOS(t *testing.T) {
	out := "12:34  up 5 days, 21:47, 3 users, load averages: 1.52 1.58 1.59"
	md := ParseUptime(out)
	if md.LoadAvg1 != 1.52 {
		t.Errorf("LoadAvg1 = %v, want 1.52", md.LoadAvg1)
	}
	want := int64(5*86400 + 21*3600 + 47*60)
	if md.UptimeSecs != want {
		t.Errorf("UptimeSecs = %d, want %d", md.UptimeSecs, want)
	}
}

func TestParseUptimeMinutesOnly(t *testing.T) {
	out := "12:34  up 12 mins, 1 user, load averages: 0.10 0.20 0.30"
	md := ParseUptime(out)
	if md.LoadAvg1 != 0.10 {
		t.Errorf("LoadAvg1 = %v, want 0.10", md.LoadAvg1)
	}
	if md.UptimeSecs != 12*60 {
		t.Errorf("UptimeSecs = %d, want %d", md.UptimeSecs, 12*60)
	}
}

func TestParseUptimeDaysOnly(t *testing.T) {
	md := ParseUptime("12:34  up 10 days, 4 users, load averages: 0.01 0.02 0.03")
	if md.UptimeSecs != 10*86400 {
		t.Errorf("UptimeSecs = %d, want %d", md.UptimeSecs, 10*86400)
	}
}

func TestParseUptimeHoursMinutesNoUsers(t *testing.T) {
	md := ParseUptime("12:34  up  1:30, load averages: 0.10 0.20 0.30")
	if md.UptimeSecs != 3600+30*60 {
		t.Errorf("UptimeSecs = %d, want %d", md.UptimeSecs, 3600+30*60)
	}
}

// Regression: the duration spans two comma-separated fields ("3 days" and
// "4:05"). An earlier implementation stopped at the first comma and silently
// dropped the hours and minutes.
func TestUptimeDurationSpansMultipleCommaFields(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"12:00 up 3 days,  4:05,  2 users,  load average: 0.5, 0.5, 0.5", 3*86400 + 4*3600 + 5*60},
		{"12:00 up 5 days, 21:47, 3 users, load averages: 1.5 1.5 1.5", 5*86400 + 21*3600 + 47*60},
		{"12:00 up 1 day, 0:01, 1 user, load average: 0.0, 0.0, 0.0", 86400 + 60},
	}
	for _, c := range cases {
		if got := ParseUptime(c.in).UptimeSecs; got != c.want {
			t.Errorf("ParseUptime(%q).UptimeSecs = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestParseUptimeGarbage(t *testing.T) {
	for _, in := range []string{"", "   ", "totally unrelated output", "load average: notanumber"} {
		md := ParseUptime(in)
		if md.LoadAvg1 != 0 || md.UptimeSecs != 0 {
			t.Errorf("ParseUptime(%q) = %+v, want zero value", in, md)
		}
	}
}

func TestParseProcLoadavg(t *testing.T) {
	md := ParseProcLoadavg("0.42 0.31 0.25 1/512 12345")
	if md.LoadAvg1 != 0.42 {
		t.Errorf("LoadAvg1 = %v, want 0.42", md.LoadAvg1)
	}
	if got := ParseProcLoadavg("").LoadAvg1; got != 0 {
		t.Errorf("empty input LoadAvg1 = %v, want 0", got)
	}
}

func TestSampleMetrics(t *testing.T) {
	conn := &fakeConn{reply: ExecResult{Stdout: "12:34  up 2 days, 1:00, 1 user, load averages: 0.75 0.50 0.25"}}
	m := New(&fakeDialer{conn: conn})
	d, _ := m.Add("laptop", validTarget())
	if err := m.Connect(context.Background(), d.ID); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	md, err := m.SampleMetrics(context.Background(), d.ID)
	if err != nil {
		t.Fatalf("SampleMetrics: %v", err)
	}
	if md.DeviceID != d.ID {
		t.Errorf("DeviceID = %q, want %q", md.DeviceID, d.ID)
	}
	if md.LoadAvg1 != 0.75 {
		t.Errorf("LoadAvg1 = %v, want 0.75", md.LoadAvg1)
	}
	if md.SampledAt.IsZero() {
		t.Error("SampledAt was not populated")
	}
}

// TestConcurrentRegistry exercises the mutex under -race.
func TestConcurrentRegistry(t *testing.T) {
	m := newTestManager()

	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			d, err := m.Add(fmt.Sprintf("dev-%d", i), validTarget())
			if err != nil {
				t.Errorf("Add: %v", err)
				return
			}
			_ = m.List()
			_, _ = m.Get(d.ID)
			_ = m.Remove(d.ID)
		}(i)
	}
	wg.Wait()

	if got := len(m.List()); got != 0 {
		t.Errorf("registry = %d entries, want 0 after add/remove pairs", got)
	}
}
