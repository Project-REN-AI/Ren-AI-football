// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package domain_test

import (
	"errors"
	"testing"

	"github.com/Project-REN-AI/Ren-AI-football/services/go-example/internal/domain"
)

func TestGreetAddressesTheName(t *testing.T) {
	t.Parallel()

	greeting, err := domain.Greet("Scout")
	if err != nil {
		t.Fatalf("Greet(%q) returned error %v", "Scout", err)
	}

	if greeting != "Hello, Scout!" {
		t.Errorf("Greet(%q) = %q, want %q", "Scout", greeting, "Hello, Scout!")
	}
}

func TestGreetRejectsABlankName(t *testing.T) {
	t.Parallel()

	_, err := domain.Greet("  ")
	if !errors.Is(err, domain.ErrBlankName) {
		t.Errorf("Greet(%q) error = %v, want %v", "  ", err, domain.ErrBlankName)
	}
}
