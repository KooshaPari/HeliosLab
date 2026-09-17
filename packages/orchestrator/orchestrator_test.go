package orchestrator

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// fixedClock returns a deterministic, monotonically advancing clock.
func fixedClock() Clock {
	base := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	var i int
	var mu sync.Mutex
	return func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		t := base.Add(time.Duration(i) * time.Second)
		i++
		return t
	}
}

func newTestOrch() *Orchestrator {
	var i int
	var mu sync.Mutex
	return NewWithClock(fixedClock(), func() string {
		mu.Lock()
		defer mu.Unlock()
		i++
		return fmt.Sprintf("id-%03d", i)
	})
}

func TestCreateSession(t *testing.T) {
	o := newTestOrch()

	s, err := o.CreateSession("ws-1")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if s.ID != "id-001" {
		t.Errorf("ID = %q, want id-001", s.ID)
	}
	if s.WorkspaceID != "ws-1" {
		t.Errorf("WorkspaceID = %q, want ws-1", s.WorkspaceID)
	}
	if s.State != StateActive {
		t.Errorf("State = %q, want %q", s.State, StateActive)
	}
	if s.Budget.Limit != DefaultTokenBudget {
		t.Errorf("budget limit = %d, want %d", s.Budget.Limit, DefaultTokenBudget)
	}
	if s.Budget.Remaining != DefaultTokenBudget {
		t.Errorf("budget remaining = %d, want %d", s.Budget.Remaining, DefaultTokenBudget)
	}

	got, err := o.GetSession(s.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got != s {
		t.Error("GetSession returned a different session pointer")
	}
}

func TestGetSessionMissing(t *testing.T) {
	o := newTestOrch()
	_, err := o.GetSession("nope")
	if !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("err = %v, want ErrSessionNotFound", err)
	}
}

func TestAddLaneAndSpawnAgent(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")

	lane, err := o.AddLane(s.ID, "build")
	if err != nil {
		t.Fatalf("AddLane: %v", err)
	}
	if lane.Name != "build" {
		t.Errorf("lane name = %q, want build", lane.Name)
	}

	agent, err := o.SpawnAgent(s.ID, lane.ID, "coder")
	if err != nil {
		t.Fatalf("SpawnAgent: %v", err)
	}
	if agent.State != AgentRunning {
		t.Errorf("agent state = %q, want %q", agent.State, AgentRunning)
	}
	if agent.LaneID != lane.ID {
		t.Errorf("agent lane = %q, want %q", agent.LaneID, lane.ID)
	}

	if len(s.Agents) != 1 {
		t.Errorf("session agent count = %d, want 1", len(s.Agents))
	}
	if len(s.Lanes) != 1 {
		t.Errorf("session lane count = %d, want 1", len(s.Lanes))
	}
}

func TestSpawnAgentRejectsUnknownLane(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")

	_, err := o.SpawnAgent(s.ID, "does-not-exist", "coder")
	if !errors.Is(err, ErrLaneMismatch) {
		t.Fatalf("err = %v, want ErrLaneMismatch", err)
	}
}

func TestSpawnAgentUnknownSession(t *testing.T) {
	o := newTestOrch()
	_, err := o.SpawnAgent("nope", "lane", "coder")
	if !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("err = %v, want ErrSessionNotFound", err)
	}
}

func TestStopAgent(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")
	lane, _ := o.AddLane(s.ID, "build")
	agent, _ := o.SpawnAgent(s.ID, lane.ID, "coder")

	if err := o.StopAgent(s.ID, agent.ID); err != nil {
		t.Fatalf("StopAgent: %v", err)
	}
	if agent.State != AgentTerminated {
		t.Errorf("agent state = %q, want %q", agent.State, AgentTerminated)
	}

	if err := o.StopAgent(s.ID, "missing"); !errors.Is(err, ErrAgentNotFound) {
		t.Errorf("err = %v, want ErrAgentNotFound", err)
	}
}

func TestRecordTokens(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSessionWithBudget("ws-1", 1000)

	exceeded, err := o.RecordTokens(s.ID, 400)
	if err != nil || exceeded {
		t.Fatalf("RecordTokens(400) = (%v, %v), want (false, nil)", exceeded, err)
	}
	if s.Budget.Used != 400 || s.Budget.Remaining != 600 {
		t.Errorf("budget = %+v, want used 400 remaining 600", s.Budget)
	}

	exceeded, err = o.RecordTokens(s.ID, 600)
	if err != nil || exceeded {
		t.Fatalf("RecordTokens(600) = (%v, %v), want (false, nil)", exceeded, err)
	}
	if s.Budget.Remaining != 0 {
		t.Errorf("remaining = %d, want 0", s.Budget.Remaining)
	}

	exceeded, err = o.RecordTokens(s.ID, 1)
	if !exceeded || !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("RecordTokens(1) = (%v, %v), want (true, ErrBudgetExceeded)", exceeded, err)
	}
	if s.Budget.Remaining != 0 {
		t.Errorf("remaining clamped = %d, want 0", s.Budget.Remaining)
	}
}

func TestRecordTokensUnlimitedBudget(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSessionWithBudget("ws-1", 0)

	if exceeded, err := o.RecordTokens(s.ID, 5_000_000); err != nil || exceeded {
		t.Fatalf("unlimited budget reported exceeded: (%v, %v)", exceeded, err)
	}
	if s.Budget.Remaining != -1 {
		t.Errorf("remaining = %d, want -1 sentinel for unlimited", s.Budget.Remaining)
	}
}

func TestRecordTokensRejectsNegative(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")
	if _, err := o.RecordTokens(s.ID, -1); err == nil {
		t.Fatal("expected error for negative tokens")
	}
}

func TestDestroySession(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")
	lane, _ := o.AddLane(s.ID, "build")
	agent, _ := o.SpawnAgent(s.ID, lane.ID, "coder")

	if err := o.DestroySession(s.ID); err != nil {
		t.Fatalf("DestroySession: %v", err)
	}
	if agent.State != AgentTerminated {
		t.Errorf("agent state = %q, want terminated", agent.State)
	}
	if lane.State != StateTerminated {
		t.Errorf("lane state = %q, want terminated", lane.State)
	}
	if _, err := o.GetSession(s.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("session still present after destroy: %v", err)
	}
	if err := o.DestroySession(s.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("double destroy err = %v, want ErrSessionNotFound", err)
	}
}

func TestListSessionsOrdering(t *testing.T) {
	o := newTestOrch()
	first, _ := o.CreateSession("ws-1")
	second, _ := o.CreateSession("ws-1")
	third, _ := o.CreateSession("ws-1")

	list := o.ListSessions()
	if len(list) != 3 {
		t.Fatalf("len = %d, want 3", len(list))
	}
	order := []string{list[0].ID, list[1].ID, list[2].ID}
	want := []string{first.ID, second.ID, third.ID}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
}

func TestStatus(t *testing.T) {
	o := newTestOrch()
	s1, _ := o.CreateSession("ws-1")
	s2, _ := o.CreateSession("ws-1")
	lane, _ := o.AddLane(s1.ID, "build")
	_, _ = o.SpawnAgent(s1.ID, lane.ID, "coder")
	_, _ = o.RecordTokens(s1.ID, 120)

	st := o.Status()
	if st.Sessions != 2 {
		t.Errorf("Sessions = %d, want 2", st.Sessions)
	}
	if st.ActiveSessions != 2 {
		t.Errorf("ActiveSessions = %d, want 2", st.ActiveSessions)
	}
	if st.Agents != 1 {
		t.Errorf("Agents = %d, want 1", st.Agents)
	}
	if st.TokensUsed != 120 {
		t.Errorf("TokensUsed = %d, want 120", st.TokensUsed)
	}

	_ = o.DestroySession(s2.ID)
	if st := o.Status(); st.ActiveSessions != 1 {
		t.Errorf("after destroy ActiveSessions = %d, want 1", st.ActiveSessions)
	}
}

func TestJSONBoundary(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")
	lane, _ := o.AddLane(s.ID, "build")
	_, _ = o.SpawnAgent(s.ID, lane.ID, "coder")

	sessionsJSON, err := o.ListSessionsJSON()
	if err != nil {
		t.Fatalf("ListSessionsJSON: %v", err)
	}
	var sessions []map[string]any
	if err := json.Unmarshal([]byte(sessionsJSON), &sessions); err != nil {
		t.Fatalf("unmarshal sessions: %v (raw=%s)", err, sessionsJSON)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}

	statusJSON, err := o.StatusJSON()
	if err != nil {
		t.Fatalf("StatusJSON: %v", err)
	}
	var st map[string]any
	if err := json.Unmarshal([]byte(statusJSON), &st); err != nil {
		t.Fatalf("unmarshal status: %v (raw=%s)", err, statusJSON)
	}
	if st["agents"].(float64) != 1 {
		t.Errorf("status agents = %v, want 1", st["agents"])
	}
}

// TestConcurrentAccess exercises the mutex under -race.
func TestConcurrentAccess(t *testing.T) {
	o := newTestOrch()
	s, _ := o.CreateSession("ws-1")
	lane, _ := o.AddLane(s.ID, "build")

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := o.SpawnAgent(s.ID, lane.ID, "coder"); err != nil {
				t.Errorf("SpawnAgent: %v", err)
			}
			if _, err := o.RecordTokens(s.ID, 1); err != nil {
				t.Errorf("RecordTokens: %v", err)
			}
			_ = o.ListSessions()
			_ = o.Status()
		}(i)
	}
	wg.Wait()

	if got := len(s.Agents); got != 50 {
		t.Errorf("agents = %d, want 50", got)
	}
	if got := s.Budget.Used; got != 50 {
		t.Errorf("tokens used = %d, want 50", got)
	}
}
