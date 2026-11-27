// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package ai.renai.scout.example.domain;

/** A greeting addressed to a name that is never blank and carries no surrounding whitespace. */
public record Greeting(String name) {

  /**
   * Strips surrounding whitespace from {@code name}.
   *
   * @throws IllegalArgumentException if {@code name} is blank
   */
  public Greeting {
    name = name.strip();
    if (name.isEmpty()) {
      throw new IllegalArgumentException("name must not be blank");
    }
  }

  /**
   * Returns a greeting to {@code name} with surrounding whitespace stripped.
   *
   * @throws IllegalArgumentException if {@code name} is blank
   */
  public static Greeting to(String name) {
    return new Greeting(name);
  }

  /** Returns the greeting sentence, such as {@code Hello, Scout!}. */
  public String text() {
    return "Hello, " + name + "!";
  }
}
