// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package main

import (
	"log"
	"net/http"
	"time"

	"github.com/Project-REN-AI/Ren-AI-football/services/go-example/internal/adapter/httpapi"
)

func main() {
	server := &http.Server{
		Addr:              ":8080",
		Handler:           httpapi.NewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Fatal(server.ListenAndServe())
}
