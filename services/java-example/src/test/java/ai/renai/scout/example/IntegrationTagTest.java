// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package ai.renai.scout.example;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaAnnotation;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Tag;
import org.testcontainers.junit.jupiter.Testcontainers;

@AnalyzeClasses(
    packagesOf = IntegrationTagTest.class,
    importOptions = ImportOption.OnlyIncludeTests.class)
class IntegrationTagTest {

  private static final DescribedPredicate<JavaAnnotation<?>> integrationTag =
      DescribedPredicate.describe(
          "@Tag(\"integration\")",
          annotation ->
              annotation.getRawType().isEquivalentTo(Tag.class)
                  && "integration".equals(annotation.get("value").orElse(null)));

  @ArchTest
  static final ArchRule testcontainersTestsAreTaggedIntegration =
      classes()
          .that()
          .areAnnotatedWith(Testcontainers.class)
          .should()
          .beAnnotatedWith(integrationTag)
          .allowEmptyShould(false);
}
