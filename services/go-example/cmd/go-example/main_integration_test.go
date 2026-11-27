// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

//go:build integration

package main_test

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	runtimeImage = "gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab"
	binaryPath   = "/go-example"
	httpPort     = "8080/tcp"
)

func TestServiceGreetsOverHTTPInsideAContainer(t *testing.T) {
	t.Parallel()

	baseURL := startService(t)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantBody   string
	}{
		{name: "addresses the name", query: "name=Scout", wantStatus: http.StatusOK, wantBody: "Hello, Scout!"},
		{name: "rejects a blank name", query: "name=%20", wantStatus: http.StatusBadRequest, wantBody: "name is blank\n"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			status, body := getText(t, baseURL+"/greetings?"+tc.query)
			if status != tc.wantStatus || body != tc.wantBody {
				t.Errorf("GET /greetings?%s = %d %q, want %d %q", tc.query, status, body, tc.wantStatus, tc.wantBody)
			}
		})
	}
}

func startService(t *testing.T) string {
	t.Helper()

	binary := buildLinuxBinary(t)

	container, err := testcontainers.Run(
		t.Context(),
		runtimeImage,
		testcontainers.WithFiles(testcontainers.ContainerFile{
			HostFilePath:      binary,
			ContainerFilePath: binaryPath,
			FileMode:          0o755,
		}),
		testcontainers.WithEntrypoint(binaryPath),
		testcontainers.WithExposedPorts(httpPort),
		testcontainers.WithWaitStrategy(wait.ForListeningPort(httpPort)),
	)
	testcontainers.CleanupContainer(t, container)

	if err != nil {
		t.Fatalf("start container: %v", err)
	}

	endpoint, err := container.PortEndpoint(t.Context(), httpPort, "http")
	if err != nil {
		t.Fatalf("resolve endpoint: %v", err)
	}

	return endpoint
}

func buildLinuxBinary(t *testing.T) string {
	t.Helper()

	binary := filepath.Join(t.TempDir(), "go-example")

	build := exec.CommandContext(t.Context(), "go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS=linux")

	output, err := build.CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, output)
	}

	return binary
}

func getText(t *testing.T, url string) (int, string) {
	t.Helper()

	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}

	defer func() { _ = response.Body.Close() }()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}

	return response.StatusCode, string(body)
}
