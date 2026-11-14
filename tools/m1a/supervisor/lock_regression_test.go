package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLiveSetupLockIsNotStolenBecauseItIsOld(t *testing.T) {
	path := filepath.Join(t.TempDir(), "setup.lock")
	owned, err := acquireLaunchLock(path, time.Second)
	if err != nil || !owned {
		t.Fatal("first owner failed", err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	owned, err = acquireLaunchLock(path, time.Second)
	if err != nil || owned {
		t.Fatal("live owner's lock was stolen", err)
	}
}
