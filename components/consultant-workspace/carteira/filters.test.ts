import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROBLEM_TAG_BY_KEY, type ClientJourney } from "@/lib/consultant-workspace/journey";
import { NO_HANDOFF_TAG, isProblemFilter, matchesProblem, parseFilters, problemCounts } from "./filters";

type Journey = Pick<ClientJourney, "stage" | "handoff" | "tags">;

const tag = (key: string) => PROBLEM_TAG_BY_KEY.get(key)!;
const handoff = { summary: "ok", nextSteps: "ok", callDate: null, by: "fred@x", at: "2026-10-01T10:00:00Z" };

const onboardingNoFred: Journey = { stage: "onboarding", handoff: null, tags: [tag("sem_meta")] };
const onboardingWithFred: Journey = { stage: "onboarding", handoff, tags: [tag("sem_meta"), tag("cliente_sumido")] };
const runningNoFred: Journey = { stage: "rodando", handoff: null, tags: [tag("criativos")] };

describe('filtro "Problema"', () => {
  it("aceita tags do catálogo e 'sem passagem do Fred'; ignora o resto", () => {
    assert.equal(isProblemFilter("sem_meta"), true);
    assert.equal(isProblemFilter(NO_HANDOFF_TAG), true);
    assert.equal(isProblemFilter("inventada"), false);
    assert.equal(isProblemFilter(null), false);
    assert.equal(parseFilters(new URLSearchParams("tag=inventada")).tag, null);
    assert.equal(parseFilters(new URLSearchParams("tag=sem_fred")).tag, NO_HANDOFF_TAG);
  });

  it("'sem passagem do Fred' só pega onboarding sem passagem", () => {
    assert.equal(matchesProblem(onboardingNoFred, NO_HANDOFF_TAG), true);
    assert.equal(matchesProblem(onboardingWithFred, NO_HANDOFF_TAG), false);
    assert.equal(matchesProblem(runningNoFred, NO_HANDOFF_TAG), false);
  });

  it("tag comum filtra pela tag; sem filtro passa tudo", () => {
    assert.equal(matchesProblem(onboardingWithFred, "cliente_sumido"), true);
    assert.equal(matchesProblem(onboardingNoFred, "cliente_sumido"), false);
    assert.equal(matchesProblem(runningNoFred, null), true);
  });

  it("conta cada opção, inclusive a do Fred", () => {
    assert.deepEqual(problemCounts([onboardingNoFred, onboardingWithFred, runningNoFred]), {
      sem_meta: 2,
      cliente_sumido: 1,
      criativos: 1,
      [NO_HANDOFF_TAG]: 1,
    });
  });
});
