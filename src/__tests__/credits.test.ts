import { describe, expect, test } from "bun:test"

import { calcCost } from "../services/credits"

describe("calcCost", () => {
  test("returns correct costs per length", () => {
    expect(calcCost("short")).toBe(25)
    expect(calcCost("medium")).toBe(30)
    expect(calcCost("long")).toBe(35)
  })
})

