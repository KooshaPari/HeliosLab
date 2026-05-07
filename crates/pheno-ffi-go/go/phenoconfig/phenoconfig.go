// Package phenoconfig provides Go bindings for the phenotype-config SDK.
//
// Before using this package, build the shared library:
//
//	cargo build --release -p pheno-ffi-go
//
// Then set CGO_LDFLAGS and CGO_CFLAGS appropriately, or place the built
// library and pheno.h where cgo can find them.
package phenoconfig

/*
#cgo LDFLAGS: -lpheno_ffi
#include "../../pheno.h"
#include <stdlib.h>
*/
import "C"
import "unsafe"

// DB wraps an opaque handle to a phenotype-config database.
type DB struct {
	ptr *C.Database
}

// Open opens (or creates) a phenotype-config database at the given path.
func Open(path string) (*DB, error) {
	cs := C.CString(path)
	defer C.free(unsafe.Pointer(cs))
	ptr := C.pheno_db_open(cs)
	if ptr == nil {
		return nil, errOpen
	}
	return &DB{ptr: ptr}, nil
}

// Close releases the database handle.
func (db *DB) Close() {
	if db.ptr != nil {
		C.pheno_db_close(db.ptr)
		db.ptr = nil
	}
}

// FlagList returns the JSON array of all flags.
func (db *DB) FlagList() (string, error) {
	cs := C.pheno_flag_list(db.ptr)
	if cs == nil {
		return "", errOp
	}
	defer C.pheno_string_free(cs)
	return C.GoString(cs), nil
}

// FlagEnable enables a feature flag by name.
func (db *DB) FlagEnable(name string) error {
	cs := C.CString(name)
	defer C.free(unsafe.Pointer(cs))
	if C.pheno_flag_enable(db.ptr, cs) != 0 {
		return errOp
	}
	return nil
}

// FlagDisable disables a feature flag by name.
func (db *DB) FlagDisable(name string) error {
	cs := C.CString(name)
	defer C.free(unsafe.Pointer(cs))
	if C.pheno_flag_disable(db.ptr, cs) != 0 {
		return errOp
	}
	return nil
}

// ConfigGet returns the value of a config key.
func (db *DB) ConfigGet(key string) (string, error) {
	cs := C.CString(key)
	defer C.free(unsafe.Pointer(cs))
	val := C.pheno_config_get(db.ptr, cs)
	if val == nil {
		return "", errNotFound
	}
	defer C.pheno_string_free(val)
	return C.GoString(val), nil
}

// ConfigSet sets a config key to the given value.
func (db *DB) ConfigSet(key, value string) error {
	ck := C.CString(key)
	cv := C.CString(value)
	defer C.free(unsafe.Pointer(ck))
	defer C.free(unsafe.Pointer(cv))
	if C.pheno_config_set(db.ptr, ck, cv) != 0 {
		return errOp
	}
	return nil
}

// SecretSet encrypts and stores a secret.
func (db *DB) SecretSet(key, plaintext, hexKey string) error {
	ck := C.CString(key)
	cp := C.CString(plaintext)
	ch := C.CString(hexKey)
	defer C.free(unsafe.Pointer(ck))
	defer C.free(unsafe.Pointer(cp))
	defer C.free(unsafe.Pointer(ch))
	if C.pheno_secret_set(db.ptr, ck, cp, ch) != 0 {
		return errOp
	}
	return nil
}

// SecretGet decrypts and returns a secret.
func (db *DB) SecretGet(key, hexKey string) (string, error) {
	ck := C.CString(key)
	ch := C.CString(hexKey)
	defer C.free(unsafe.Pointer(ck))
	defer C.free(unsafe.Pointer(ch))
	val := C.pheno_secret_get(db.ptr, ck, ch)
	if val == nil {
		return "", errNotFound
	}
	defer C.pheno_string_free(val)
	return C.GoString(val), nil
}

// VersionShow returns versions as a JSON array.
func (db *DB) VersionShow() (string, error) {
	cs := C.pheno_version_show(db.ptr)
	if cs == nil {
		return "", errOp
	}
	defer C.pheno_string_free(cs)
	return C.GoString(cs), nil
}

// Sentinel errors.
var (
	errOpen     = &PhenoError{msg: "failed to open database"}
	errOp       = &PhenoError{msg: "operation failed"}
	errNotFound = &PhenoError{msg: "not found"}
)

// PhenoError is returned by phenoconfig operations.
type PhenoError struct {
	msg string
}

func (e *PhenoError) Error() string { return e.msg }
