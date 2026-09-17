// HeliosLab Orchestrator - Session lifecycle and agent swarm coordination
package main

import "C"

import (
	"encoding/json"
	"sync"
	"time"
)

// ============================================================================
// Types
// ============================================================================

type Session struct {
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspace_id"`
	LaneID      string            `json:"lane_id"`
	State       string            `json:"state"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	Agents      map[string]*Agent `json:"agents"`
}

type Agent struct {
	ID       string            `json:"id"`
	Type     string            `json:"type"`
	State    string            `json:"state"`
	Metadata map[string]string `json:"metadata"`
}

type Orchestrator struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// ============================================================================
// Core operations
// ============================================================================

func orchestratorCreate() *Orchestrator {
	return &Orchestrator{
		sessions: make(map[string]*Session),
	}
}

func (o *Orchestrator) createSession(workspaceID, laneID string) string {
	o.mu.Lock()
	defer o.mu.Unlock()

	id := generateID()
	session := &Session{
		ID:          id,
		WorkspaceID: workspaceID,
		LaneID:      laneID,
		State:       "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		Agents:      make(map[string]*Agent),
	}
	o.sessions[id] = session
	return id
}

func (o *Orchestrator) destroySession(sessionID string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()

	if _, exists := o.sessions[sessionID]; !exists {
		return false
	}

	session := o.sessions[sessionID]
	session.State = "terminated"
	session.UpdatedAt = time.Now()

	// Terminate all agents in session
	for _, agent := range session.Agents {
		agent.State = "terminated"
	}

	delete(o.sessions, sessionID)
	return true
}

func (o *Orchestrator) listSessions() string {
	o.mu.RLock()
	defer o.mu.RUnlock()

	sessions := make([]*Session, 0, len(o.sessions))
	for _, s := range o.sessions {
		sessions = append(sessions, s)
	}

	data, _ := json.Marshal(sessions)
	return string(data)
}

func (o *Orchestrator) spawnAgent(sessionID, agentType string) string {
	o.mu.Lock()
	defer o.mu.Unlock()

	session, exists := o.sessions[sessionID]
	if !exists {
		return ""
	}

	agentID := generateID()
	agent := &Agent{
		ID:       agentID,
		Type:     agentType,
		State:    "running",
		Metadata: make(map[string]string),
	}
	session.Agents[agentID] = agent
	session.UpdatedAt = time.Now()

	return agentID
}

func (o *Orchestrator) getStatus() string {
	o.mu.RLock()
	defer o.mu.RUnlock()

	status := map[string]interface{}{
		"active_sessions": len(o.sessions),
		"state":           "ready",
		"timestamp":       time.Now(),
	}

	data, _ := json.Marshal(status)
	return string(data)
}

// ============================================================================
// Helpers
// ============================================================================

func generateID() string {
	return time.Now().Format("20060102150405.000000000")
}

// ============================================================================
// C ABI exports for Bun FFI
// ============================================================================

//export orchestrator_create
func orchestrator_create() *C.Orchestrator {
	return orchestratorCreate()
}

//export orchestrator_create_session
func orchestrator_create_session(orch *C.Orchestrator, workspace_id *C.char, lane_id *C.char) C.int {
	goOrch := (*Orchestrator)(unsafe.Pointer(orch))
	goOrch.createSession(C.GoString(workspace_id), C.GoString(lane_id))
	return 0
}

//export orchestrator_destroy_session
func orchestrator_destroy_session(orch *C.Orchestrator, session_id *C.char) C.int {
	goOrch := (*Orchestrator)(unsafe.Pointer(orch))
	if goOrch.destroySession(C.GoString(session_id)) {
		return 0
	}
	return -1
}

//export orchestrator_list_sessions
func orchestrator_list_sessions(orch *C.Orchestrator) *C.char {
	goOrch := (*Orchestrator)(unsafe.Pointer(orch))
	result := goOrch.listSessions()
	return C.CString(result)
}

//export orchestrator_get_status
func orchestrator_get_status(orch *C.Orchestrator) *C.char {
	goOrch := (*Orchestrator)(unsafe.Pointer(orch))
	result := goOrch.getStatus()
	return C.CString(result)
}

//export orchestrator_free_string
func orchestrator_free_string(s *C.char) {
	C.free(unsafe.Pointer(s))
}

func main() {}
