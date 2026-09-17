// Command cshared builds the device manager as a C shared library for the Bun
// FFI bridge.
//
//	go build -buildmode=c-shared -o libhelios-device.so ./packages/device-manager/cshared
//
// The real SSH transport (with host key verification) lives in sshtransport and
// is wired in here.
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"encoding/json"
	"runtime/cgo"
	"time"
	"unsafe"

	devices "github.com/helioslab/device-manager"
	"github.com/helioslab/device-manager/sshtransport"
)

// execTimeout bounds a single remote command.
const execTimeout = 60 * time.Second

func toCString(s string) *C.char {
	if s == "" {
		return nil
	}
	return C.CString(s)
}

func toCJSON(v any) *C.char {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return toCString(string(b))
}

func manager(h C.uintptr_t) (*devices.Manager, bool) {
	v := cgo.Handle(h).Value()
	if v == nil {
		return nil, false
	}
	m, ok := v.(*devices.Manager)
	return m, ok
}

//export HeliosDevicesNew
func HeliosDevicesNew() C.uintptr_t {
	return C.uintptr_t(cgo.NewHandle(devices.New(sshtransport.New())))
}

//export HeliosDevicesAdd
func HeliosDevicesAdd(
	h C.uintptr_t,
	name, host *C.char,
	port C.int,
	user, keyPath *C.char,
) *C.char {
	m, ok := manager(h)
	if !ok {
		return nil
	}
	d, err := m.Add(C.GoString(name), devices.Target{
		Host:    C.GoString(host),
		Port:    int(port),
		User:    C.GoString(user),
		KeyPath: C.GoString(keyPath),
	})
	if err != nil {
		return nil
	}
	return toCString(d.ID)
}

// deviceView is the wire shape the TypeScript side expects.
type deviceView struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Host  string `json:"host"`
	Port  int    `json:"port"`
	User  string `json:"user"`
	State string `json:"state"`
}

//export HeliosDevicesList
func HeliosDevicesList(h C.uintptr_t) *C.char {
	m, ok := manager(h)
	if !ok {
		return nil
	}
	all := m.List()
	views := make([]deviceView, 0, len(all))
	for _, d := range all {
		views = append(views, deviceView{
			ID:    d.ID,
			Name:  d.Name,
			Host:  d.Target.Host,
			Port:  d.Target.Port,
			User:  d.Target.User,
			State: d.State,
		})
	}
	return toCJSON(views)
}

//export HeliosDevicesConnect
func HeliosDevicesConnect(h C.uintptr_t, deviceID *C.char) C.int {
	m, ok := manager(h)
	if !ok {
		return -1
	}
	if err := m.Connect(context.Background(), C.GoString(deviceID)); err != nil {
		return -1
	}
	return 0
}

//export HeliosDevicesDisconnect
func HeliosDevicesDisconnect(h C.uintptr_t, deviceID *C.char) C.int {
	m, ok := manager(h)
	if !ok {
		return -1
	}
	if err := m.Disconnect(C.GoString(deviceID)); err != nil {
		return -1
	}
	return 0
}

//export HeliosDevicesRemove
func HeliosDevicesRemove(h C.uintptr_t, deviceID *C.char) C.int {
	m, ok := manager(h)
	if !ok {
		return -1
	}
	if err := m.Remove(C.GoString(deviceID)); err != nil {
		return -1
	}
	return 0
}

// execOutcome mirrors devices.ExecResult on the wire.
type execOutcome struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
	// Truncated reports that the 1 MiB output cap was hit.
	Truncated bool `json:"truncated,omitempty"`
}

// maxOutputBytes caps captured output so a chatty remote command cannot exhaust
// memory in the host process.
const maxOutputBytes = 1 << 20

//export HeliosDevicesExec
func HeliosDevicesExec(h C.uintptr_t, deviceID, command *C.char) *C.char {
	m, ok := manager(h)
	if !ok {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), execTimeout)
	defer cancel()

	res, err := m.Exec(ctx, C.GoString(deviceID), C.GoString(command))
	if err != nil {
		return toCJSON(execOutcome{Stderr: err.Error(), ExitCode: -1})
	}

	out := execOutcome{Stdout: res.Stdout, Stderr: res.Stderr, ExitCode: res.ExitCode}
	if len(out.Stdout) > maxOutputBytes {
		out.Stdout = out.Stdout[:maxOutputBytes]
		out.Truncated = true
	}
	if len(out.Stderr) > maxOutputBytes {
		out.Stderr = out.Stderr[:maxOutputBytes]
		out.Truncated = true
	}
	return toCJSON(out)
}

//export HeliosDevicesFree
func HeliosDevicesFree(s *C.char) {
	if s != nil {
		C.free(unsafe.Pointer(s))
	}
}

//export HeliosDevicesClose
func HeliosDevicesClose(h C.uintptr_t) {
	m, ok := manager(h)
	if !ok {
		return
	}
	// Close every live connection before dropping the manager.
	for _, d := range m.List() {
		if d.State == devices.StateConnected {
			_ = m.Disconnect(d.ID)
		}
	}
	cgo.Handle(h).Delete()
}

func main() {}
