//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func processAlive(pid int) bool {
	handle, err := syscall.OpenProcess(0x1000, false, uint32(pid))
	if err != nil {
		return err == syscall.ERROR_ACCESS_DENIED
	}
	defer syscall.CloseHandle(handle)
	var code uint32
	result, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetExitCodeProcess").Call(uintptr(handle), uintptr(unsafe.Pointer(&code)))
	return result != 0 && code == 259
}
