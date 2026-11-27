// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package ai.renai.scout.example.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import org.junit.jupiter.api.Test;

class GreetingTest {

  @Test
  void greetsByName() {
    assertThat(Greeting.to("Scout").text()).isEqualTo("Hello, Scout!");
  }

  @Test
  void stripsTheName() {
    assertThat(Greeting.to("  Scout ").text()).isEqualTo("Hello, Scout!");
  }

  @Test
  void rejectsABlankName() {
    assertThatIllegalArgumentException().isThrownBy(() -> Greeting.to("   "));
  }
}
