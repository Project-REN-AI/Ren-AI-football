// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package ai.renai.scout.example.integration;

import static org.assertj.core.api.Assertions.assertThat;

import ai.renai.scout.example.domain.Greeting;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Tag("integration")
@Testcontainers
class PostgresIntegrationTest {

  @Container
  static final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");

  @Test
  void storesAndReadsBackAGreeting() throws SQLException {
    try (Connection connection =
        DriverManager.getConnection(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())) {
      try (Statement ddl = connection.createStatement()) {
        ddl.execute("create table greeting (text varchar(200) not null)");
      }
      try (PreparedStatement insert =
          connection.prepareStatement("insert into greeting (text) values (?)")) {
        insert.setString(1, Greeting.to(" Scout ").text());
        insert.executeUpdate();
      }
      try (Statement select = connection.createStatement();
          ResultSet rows = select.executeQuery("select text from greeting")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString("text")).isEqualTo("Hello, Scout!");
      }
    }
  }
}
