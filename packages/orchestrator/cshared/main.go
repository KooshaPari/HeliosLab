// Command cshared builds the orchestrator as a C shared library for the Bun
// FFI bridge.
//
//	go build -buildmode=c-shared -o libhelios-orchestrator.so ./packages/orchestrator/cshared
//
// Handles are passed to C as `cgo.Handle` values rather than raw Go pointers:
// cgo forbids C from retaining Go pointers, and the handle table keeps the
// pointers visible to the garbage collector.
//
// Returning a `char *` is NULL on failure. The caller must release it with
// HeliosOrchestratorFree.
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"errors"
	"runtime/cgo"
	"unsafe"

	orch "github.com/helioslab/orchestrator"
)

// Writes s into a C string, or NULL when the operation failed.
func toCString(s string) *C.char {
	if s == "" {
		return nil
	}
	return C.CString(s)
}

func orchestrator(h C.uintptr_t) (*orch.Orchestrator, bool) {
	v := cgo.Handle(h).Value()
	if v == nil {
		return nil, false
	}
	o, ok := v.(*orch.Orchestrator)
	return o, ok
}

//export HeliosOrchestratorNew
func HeliosOrchestratorNew() C.uintptr_t {
	return C.uintptr_t(cgo.NewHandle(orch.New()))
}

//export HeliosOrchestratorCreateSession
func HeliosOrchestratorCreateSession(h C.uintptr_t, workspaceID *C.char, budget C.longlong) *C.char {
	o, ok := orchestrator(h)
	if !ok {
		return nil
	}
	s, err := o.CreateSessionWithBudget(C.GoString(workspaceID), int64(budget))
	if err != nil {
		return nil
	}
	return toCString(s.ID)
}

//export HeliosOrchestratorAddLane
func HeliosOrchestratorAddLane(h C.uintptr_t, sessionID, name *C.char) *C.char {
	o, ok := orchestrator(h)
	if !ok {
		return nil
	}
	lane, err := o.AddLane(C.GoString(sessionID), C.GoString(name))
	if err != nil {
		return nil
	}
	return toCString(lane.ID)
}

//export HeliosOrchestratorSpawnAgent
func HeliosOrchestratorSpawnAgent(h C.uintptr_t, sessionID, laneID, agentType *C.char) *C.char {
	o, ok := orchestrator(h)
	if !ok {
		return nil
	}
	agent, err := o.SpawnAgent(C.GoString(sessionID), C.GoString(laneID), C.GoString(agentType))
	if err != nil {
		return nil
	}
	return toCString(agent.ID)
}

// HeliosOrchestratorRecordTokens returns 0 on success, 1 when the session has
// now exceeded its budget, and -1 on error.
//
//export HeliosOrchestratorRecordTokens
func HeliosOrchestratorRecordTokens(h C.uintptr_t, sessionID *C.char, tokens C.longlong) C.int {
	o, ok := orchestrator(h)
	if !ok {
		return -1
	}
	exceeded, err := o.RecordTokens(C.GoString(sessionID), int64(tokens))
	if errors.Is(err, orch.ErrBudgetExceeded) {
		return 1
	}
	if err != nil {
		return -1
	}
	if exceeded {
		return 1
	}
	return 0
}

//export HeliosOrchestratorDestroySession
func HeliosOrchestratorDestroySession(h C.uintptr_t, sessionID *C.char) C.int {
	o, ok := orchestrator(h)
	if !ok {
		return -1
	}
	if err := o.DestroySession(C.GoString(sessionID)); err != nil {
		return -1
	}
	return 0
}

//export HeliosOrchestratorListSessions
func HeliosOrchestratorListSessions(h C.uintptr_t) *C.char {
	o, ok := orchestrator(h)
	if !ok {
		return nil
	}
	json, err := o.ListSessionsJSON()
	if err != nil {
		return nil
	}
	if json == "null" {
		json = "[]"
	}
	return toCString(json)
}

//export HeliosOrchestratorStatus
func HeliosOrchestratorStatus(h C.uintptr_t) *C.char {
	o, ok := orchestrator(h)
	if !ok {
		return nil
	}
	json, err := o.StatusJSON()
	if err != nil {
		return nil
	}
	return toCString(json)
}

//export HeliosOrchestratorFree
func HeliosOrchestratorFree(s *C.char) {
	if s != nil {
		C.free(unsafe.Pointer(s))
	}
}

//export HeliosOrchestratorClose
func HeliosOrchestratorClose(h C.uintptr_t) {
	if _, ok := orchestrator(h); ok {
		cgo.Handle(h).Delete()
	}
}

func main() {}
