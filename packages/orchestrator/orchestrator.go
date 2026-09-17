// Package orchestrator implements HeliosLab session lifecycle and agent
// swarm coordination.
//
// The package is deliberately dependency-free and cgo-free so that its logic
// can be built and tested on any platform. The C ABI surface used by the Bun
// FFI bridge lives in ./cshared, which is a thin wrapper over this package.
package orchestrator

import (
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"
)

// Session state values.
const (
	StateActive     = "active"
	StateSuspended  = "suspended"
	StateTerminated = "terminated"
)

// Agent state values.
const (
	AgentRunning    = "running"
	AgentIdle       = "idle"
	AgentTerminated = "terminated"
)

var (
	ErrSessionNotFound = errors.New("session not found")
	ErrAgentNotFound   = errors.New("agent not found")
	ErrBudgetExceeded  = errors.New("token budget exceeded")
	ErrLaneMismatch    = errors.New("lane does not belong to session")
)

// Clock abstracts time so tests can be deterministic.
type Clock func() time.Time

// IDGen abstracts ID generation so tests can be deterministic.
type IDGen func() string

// Agent is a worker bound to a session.
type Agent struct {
	ID       string            `json:"id"`
	Type     string            `json:"type"`
	LaneID   string            `json:"lane_id"`
	State    string            `json:"state"`
	Metadata map[string]string `json:"metadata,omitempty"`
	JoinedAt time.Time         `json:"joined_at"`
}

// Lane is a named execution context inside a session (for example "build",
// "review", or a terminal pane).
type Lane struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	State     string    `json:"state"`
	CreatedAt time.Time `json:"created_at"`
}

// TokenBudget tracks the per-session lifetime token allowance described in the
// architecture notes (100M lifetime tokens, not simultaneous context).
type TokenBudget struct {
	Limit     int64 `json:"limit"`
	Used      int64 `json:"used"`
	Remaining int64 `json:"remaining"`
}

// Session is a unit of work owned by the orchestrator.
type Session struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	State       string         `json:"state"`
	Lanes       []*Lane        `json:"lanes"`
	Agents      []*Agent       `json:"agents"`
	Budget      TokenBudget    `json:"budget"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`

	agents map[string]*Agent
	lanes  map[string]*Lane
}

// Status is the orchestrator health snapshot returned to the UI.
type Status struct {
	Sessions       int       `json:"sessions"`
	ActiveSessions int       `json:"active_sessions"`
	Agents         int       `json:"agents"`
	TokensUsed     int64     `json:"tokens_used"`
	Timestamp      time.Time `json:"timestamp"`
}

// Orchestrator owns all sessions. It is safe for concurrent use.
type Orchestrator struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	seq      uint64
	now      Clock
	newID    IDGen
}

// DefaultTokenBudget is the lifetime per-session allowance.
const DefaultTokenBudget int64 = 100_000_000

// New creates an orchestrator using real clock and ID generation.
func New() *Orchestrator {
	return NewWithClock(func() time.Time { return time.Now().UTC() }, nil)
}

// NewWithClock creates an orchestrator with injectable time and ID sources.
// If idGen is nil a monotonic counter-based generator is used.
func NewWithClock(now Clock, idGen IDGen) *Orchestrator {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	o := &Orchestrator{
		sessions: make(map[string]*Session),
		now:      now,
	}
	if idGen != nil {
		o.newID = idGen
	} else {
		o.newID = o.nextID
	}
	return o
}

func (o *Orchestrator) nextID() string {
	o.seq++
	return "sess-" + time.Duration(o.seq).String() + "-" + o.now().Format("20060102150405")
}

// CreateSession registers a new session with the default token budget.
func (o *Orchestrator) CreateSession(workspaceID string) (*Session, error) {
	return o.CreateSessionWithBudget(workspaceID, DefaultTokenBudget)
}

// CreateSessionWithBudget registers a new session with an explicit budget.
// A non-positive limit means unlimited.
func (o *Orchestrator) CreateSessionWithBudget(workspaceID string, budget int64) (*Session, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	now := o.now()
	s := &Session{
		ID:          o.newID(),
		WorkspaceID: workspaceID,
		State:       StateActive,
		CreatedAt:   now,
		UpdatedAt:   now,
		Budget:      TokenBudget{Limit: budget, Used: 0, Remaining: budget},
		agents:      make(map[string]*Agent),
		lanes:       make(map[string]*Lane),
	}
	o.sessions[s.ID] = s
	return s, nil
}

// GetSession returns a session by ID.
func (o *Orchestrator) GetSession(id string) (*Session, error) {
	o.mu.RLock()
	defer o.mu.RUnlock()
	s, ok := o.sessions[id]
	if !ok {
		return nil, ErrSessionNotFound
	}
	return s, nil
}

// AddLane attaches a lane to a session.
func (o *Orchestrator) AddLane(sessionID, name string) (*Lane, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	s, ok := o.sessions[sessionID]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if s.State == StateTerminated {
		return nil, ErrSessionNotFound
	}

	lane := &Lane{
		ID:        o.newID() + "-lane",
		Name:      name,
		State:     StateActive,
		CreatedAt: o.now(),
	}
	s.lanes[lane.ID] = lane
	s.Lanes = append(s.Lanes, lane)
	s.UpdatedAt = o.now()
	return lane, nil
}

// SpawnAgent attaches a worker to a lane in a session.
func (o *Orchestrator) SpawnAgent(sessionID, laneID, agentType string) (*Agent, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	s, ok := o.sessions[sessionID]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if s.State == StateTerminated {
		return nil, ErrSessionNotFound
	}
	if _, ok := s.lanes[laneID]; !ok {
		return nil, ErrLaneMismatch
	}

	a := &Agent{
		ID:       o.newID() + "-agent",
		Type:     agentType,
		LaneID:   laneID,
		State:    AgentRunning,
		Metadata: map[string]string{},
		JoinedAt: o.now(),
	}
	s.agents[a.ID] = a
	s.Agents = append(s.Agents, a)
	s.UpdatedAt = o.now()
	return a, nil
}

// StopAgent marks an agent terminated. The agent record is retained so history
// stays inspectable.
func (o *Orchestrator) StopAgent(sessionID, agentID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	s, ok := o.sessions[sessionID]
	if !ok {
		return ErrSessionNotFound
	}
	a, ok := s.agents[agentID]
	if !ok {
		return ErrAgentNotFound
	}
	a.State = AgentTerminated
	s.UpdatedAt = o.now()
	return nil
}

// RecordTokens adds token usage to a session and reports whether the budget is
// now exceeded. Sessions with a non-positive limit never exceed.
func (o *Orchestrator) RecordTokens(sessionID string, tokens int64) (bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	s, ok := o.sessions[sessionID]
	if !ok {
		return false, ErrSessionNotFound
	}
	if tokens < 0 {
		return false, errors.New("tokens must not be negative")
	}

	s.Budget.Used += tokens
	if s.Budget.Limit > 0 {
		s.Budget.Remaining = s.Budget.Limit - s.Budget.Used
		if s.Budget.Remaining < 0 {
			s.Budget.Remaining = 0
			s.UpdatedAt = o.now()
			return true, ErrBudgetExceeded
		}
	} else {
		s.Budget.Remaining = -1
	}
	s.UpdatedAt = o.now()
	return false, nil
}

// DestroySession terminates a session and all of its agents and lanes. The
// session is removed from the active set.
func (o *Orchestrator) DestroySession(sessionID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	s, ok := o.sessions[sessionID]
	if !ok {
		return ErrSessionNotFound
	}
	for _, a := range s.Agents {
		a.State = AgentTerminated
	}
	for _, l := range s.Lanes {
		l.State = StateTerminated
	}
	s.State = StateTerminated
	s.UpdatedAt = o.now()
	delete(o.sessions, sessionID)
	return nil
}

// ListSessions returns sessions ordered by creation time (oldest first).
func (o *Orchestrator) ListSessions() []*Session {
	o.mu.RLock()
	defer o.mu.RUnlock()

	out := make([]*Session, 0, len(o.sessions))
	for _, s := range o.sessions {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}

// Status returns an aggregate health snapshot.
func (o *Orchestrator) Status() Status {
	o.mu.RLock()
	defer o.mu.RUnlock()

	st := Status{Sessions: len(o.sessions), Timestamp: o.now()}
	for _, s := range o.sessions {
		if s.State == StateActive {
			st.ActiveSessions++
		}
		st.Agents += len(s.Agents)
		st.TokensUsed += s.Budget.Used
	}
	return st
}

// ListSessionsJSON serialises ListSessions for the FFI boundary.
func (o *Orchestrator) ListSessionsJSON() (string, error) {
	b, err := json.Marshal(o.ListSessions())
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// StatusJSON serialises Status for the FFI boundary.
func (o *Orchestrator) StatusJSON() (string, error) {
	b, err := json.Marshal(o.Status())
	if err != nil {
		return "", err
	}
	return string(b), nil
}
