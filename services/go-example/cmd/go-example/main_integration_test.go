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
	runtimeImage = "gcr.io/distroless/static-debian12:nonroot"
	binaryPath   = "/go-example"
	httpPort     = "8080/tcp"
)

func TestServiceGreetsOverHTTPInsideAContainer(t *testing.T) {
	t.Parallel()

	baseURL := startService(t)

	status, body := get(t, baseURL+"/greetings?name=Scout")
	if status != http.StatusOK || body != "Hello, Scout!" {
		t.Errorf("GET /greetings?name=Scout = %d %q, want %d %q", status, body, http.StatusOK, "Hello, Scout!")
	}

	status, _ = get(t, baseURL+"/greetings?name=%20")
	if status != http.StatusBadRequest {
		t.Errorf("GET /greetings?name=%%20 = %d, want %d", status, http.StatusBadRequest)
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

func get(t *testing.T, url string) (int, string) {
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
