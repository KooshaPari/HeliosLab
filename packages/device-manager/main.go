// HeliosLab Device Manager - SSH remote device fleet
package main

import "C"

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// ============================================================================
// Types
// ============================================================================

type Device struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	KeyPath  string `json:"key_path"`
	State    string `json:"state"`
	Connected bool  `json:"connected"`
}

type Metrics struct {
	DeviceID    string  `json:"device_id"`
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryUsage float64 `json:"memory_usage"`
	DiskUsage   float64 `json:"disk_usage"`
	LoadAvg     float64 `json:"load_avg"`
	Uptime      uint64  `json:"uptime"`
}

type DeviceManager struct {
	devices  map[string]*Device
	clients  map[string]*ssh.Client
	mu       sync.RWMutex
}

// ============================================================================
// Core operations
// ============================================================================

func deviceManagerCreate() *DeviceManager {
	return &DeviceManager{
		devices: make(map[string]*Device),
		clients: make(map[string]*ssh.Client),
	}
}

func (dm *DeviceManager) addDevice(name, host string, port int, user, keyPath string) string {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	id := generateDeviceID()
	device := &Device{
		ID:      id,
		Name:    name,
		Host:    host,
		Port:    port,
		User:    user,
		KeyPath: keyPath,
		State:   "registered",
	}
	dm.devices[id] = device
	return id
}

func (dm *DeviceManager) listDevices() string {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	devices := make([]*Device, 0, len(dm.devices))
	for _, d := range dm.devices {
		devices = append(devices, d)
	}

	data, _ := json.Marshal(devices)
	return string(data)
}

func (dm *DeviceManager) connect(deviceID string) bool {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	device, exists := dm.devices[deviceID]
	if !exists {
		return false
	}

	// Read private key
	key, err := os.ReadFile(device.KeyPath)
	if err != nil {
		return false
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return false
	}

	config := &ssh.ClientConfig{
		User: device.User,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := device.Host + ":" + string(rune('0'+device.Port))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return false
	}

	dm.clients[deviceID] = client
	device.State = "connected"
	device.Connected = true
	return true
}

func (dm *DeviceManager) disconnect(deviceID string) bool {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	client, exists := dm.clients[deviceID]
	if !exists {
		return false
	}

	client.Close()
	delete(dm.clients, deviceID)

	device := dm.devices[deviceID]
	if device != nil {
		device.State = "disconnected"
		device.Connected = false
	}
	return true
}

func (dm *DeviceManager) execCommand(deviceID, command string) string {
	dm.mu.RLock()
	client, exists := dm.clients[deviceID]
	dm.mu.RUnlock()

	if !exists {
		return `{"error": "device not connected"}`
	}

	session, err := client.NewSession()
	if err != nil {
		return `{"error": "` + err.Error() + `"}`
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return `{"error": "` + err.Error() + `", "output": "` + string(output) + `"}`
	}

	result := map[string]string{
		"output": string(output),
		"status": "success",
	}
	data, _ := json.Marshal(result)
	return string(data)
}

func (dm *DeviceManager) getMetrics(deviceID string) string {
	dm.mu.RLock()
	client, exists := dm.clients[deviceID]
	dm.mu.RUnlock()

	if !exists {
		return `{"error": "device not connected"}`
	}

	// Execute system metrics collection command
	session, err := client.NewSession()
	if err != nil {
		return `{"error": "` + err.Error() + `"}`
	}
	defer session.Close()

	// Collect basic metrics via shell commands
	output, err := session.CombinedOutput("top -bn1 | head -5")
	if err != nil {
		return `{"error": "` + err.Error() + `"}`
	}

	metrics := Metrics{
		DeviceID: deviceID,
		CPUUsage: 0.0, // Parse from top output
	}

	// In production, parse the output properly
	_ = output
	data, _ := json.Marshal(metrics)
	return string(data)
}

// ============================================================================
// Helpers
// ============================================================================

func generateDeviceID() string {
	return time.Now().Format("20060102150405.000000000")
}

// ============================================================================
// C ABI exports for Bun FFI
// ============================================================================

//export device_manager_create
func device_manager_create() *C.DeviceManager {
	return deviceManagerCreate()
}

//export device_manager_add_device
func device_manager_add_device(dm *C.DeviceManager, name *C.char, host *C.char, port C.int, user *C.char, key_path *C.char) C.int {
	goDM := (*DeviceManager)(unsafe.Pointer(dm))
	goDM.addDevice(C.GoString(name), C.GoString(host), int(port), C.GoString(user), C.GoString(key_path))
	return 0
}

//export device_manager_list_devices
func device_manager_list_devices(dm *C.DeviceManager) *C.char {
	goDM := (*DeviceManager)(unsafe.Pointer(dm))
	result := goDM.listDevices()
	return C.CString(result)
}

//export device_manager_connect
func device_manager_connect(dm *C.DeviceManager, device_id *C.char) C.int {
	goDM := (*DeviceManager)(unsafe.Pointer(dm))
	if goDM.connect(C.GoString(device_id)) {
		return 0
	}
	return -1
}

//export device_manager_disconnect
func device_manager_disconnect(dm *C.DeviceManager, device_id *C.char) C.int {
	goDM := (*DeviceManager)(unsafe.Pointer(dm))
	if goDM.disconnect(C.GoString(device_id)) {
		return 0
	}
	return -1
}

//export device_manager_exec
func device_manager_exec(dm *C.DeviceManager, device_id *C.char, command *C.char) *C.char {
	goDM := (*DeviceManager)(unsafe.Pointer(dm))
	result := goDM.execCommand(C.GoString(device_id), C.GoString(command))
	return C.CString(result)
}

//export device_manager_get_metrics
func device_manager_get_metrics(dm *C.DeviceManager, device_id *C.char) *C.char {
	goDM := (*DeviceManager)(unsafe.Pointer(dm))
	result := goDM.getMetrics(C.GoString(device_id))
	return C.CString(result)
}

//export device_manager_free_string
func device_manager_free_string(s *C.char) {
	C.free(unsafe.Pointer(s))
}

func main() {}
