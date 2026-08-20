import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_ID,
  WEATHER_MODELS,
  describeWeatherModel,
  findWeatherModel,
  formatModelList,
  isSupportedModelId,
} from "../models.ts";

test("the model allowlist has unique ids and contains the default", () => {
  const ids = WEATHER_MODELS.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(DEFAULT_MODEL_ID));
  assert.equal(DEFAULT_MODEL_ID, "best_match");
});

test("every allowlisted model has a non-trivial description", () => {
  for (const model of WEATHER_MODELS) {
    assert.ok(model.description.length > 2, model.id);
  }
});

test("isSupportedModelId accepts allowlisted ids and rejects everything else", () => {
  assert.equal(isSupportedModelId("cma_grapes_global"), true);
  assert.equal(isSupportedModelId("gem_seamless"), true);
  assert.equal(isSupportedModelId("knmi_seamless"), true);
  assert.equal(isSupportedModelId("best_match"), true);

  assert.equal(isSupportedModelId("gfs_hrrr"), false);
  assert.equal(isSupportedModelId("ecmwf_aifs025"), false);
  assert.equal(isSupportedModelId("kma_seamless"), false);
  assert.equal(isSupportedModelId("bom_access_global"), false);
  assert.equal(isSupportedModelId("Bok_Match"), false);
  assert.equal(isSupportedModelId(""), false);
  assert.equal(isSupportedModelId(undefined), false);
  assert.equal(isSupportedModelId(42), false);
});

test("findWeatherModel and describeWeatherModel resolve ids safely", () => {
  assert.equal(findWeatherModel("icon_seamless")?.description.includes("ICON"), true);
  assert.equal(findWeatherModel("nope"), undefined);

  assert.equal(describeWeatherModel(undefined), describeWeatherModel("best_match"));
  assert.equal(describeWeatherModel("nope"), "nope");
});

test("formatModelList lists one entry per model", () => {
  const lines = formatModelList().split("\n");
  assert.equal(lines.length, WEATHER_MODELS.length);
  assert.ok(lines[0]!.startsWith("  best_match"));
});
