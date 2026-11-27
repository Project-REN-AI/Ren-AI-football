// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package domain

import (
	"errors"
	"strings"
)

var ErrBlankName = errors.New("name is blank")

func Greet(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", ErrBlankName
	}

	return "Hello, " + trimmed + "!", nil
}
