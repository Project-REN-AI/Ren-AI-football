// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package ai.renai.scout.example;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTag;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@ArchTag("architecture")
@AnalyzeClasses(
    packagesOf = ArchitectureTest.class,
    importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

  @ArchTest
  static final ArchRule domainDependsOnlyOnTheJdkCoreAndJspecify =
      classes()
          .that()
          .resideInAPackage("..domain..")
          .should()
          .onlyDependOnClassesThat()
          .resideInAnyPackage(
              "..domain..",
              "java.lang..",
              "java.util..",
              "java.time..",
              "java.math..",
              "org.jspecify..")
          .allowEmptyShould(false);
}
