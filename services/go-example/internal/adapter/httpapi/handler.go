// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package httpapi

import (
	"errors"
	"net/http"

	"github.com/Project-REN-AI/Ren-AI-football/services/go-example/internal/domain"
)

func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /greetings", greet)

	return mux
}

func greet(w http.ResponseWriter, r *http.Request) {
	greeting, err := domain.Greet(r.URL.Query().Get("name"))
	if errors.Is(err, domain.ErrBlankName) {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(greeting))
}
