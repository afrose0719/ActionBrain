import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getDesktopBridge, parseDesktopCall } from "../src/lib/desktop-bridge.ts";

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.window;
});

test("only the helper's own link opens the call recorder, and only for the two known apps", () => {
  assert.deepEqual(parseDesktopCall("?desktop=call&via=WhatsApp"), { via: "WhatsApp" });
  assert.deepEqual(parseDesktopCall("?desktop=call&via=Microsoft%20Teams"), { via: "Microsoft Teams" });
  assert.deepEqual(parseDesktopCall("?desktop=call&via=Google%20Meet%20%2F%20browser"), { via: "Google Meet / browser" });
  assert.equal(parseDesktopCall("?desktop=call&via=<script>"), null);
  assert.equal(parseDesktopCall("?via=WhatsApp"), null);
  assert.equal(parseDesktopCall(""), null);
});

test("in an ordinary browser there is no helper, so nothing auto-records", () => {
  g.window = {};
  assert.equal(getDesktopBridge(), null);
});

test("a half-made or fake helper object is refused", () => {
  g.window = { ActionBrainDesktop: { isDesktop: true, onCallEnded() {} } };
  assert.equal(getDesktopBridge(), null);
  g.window = { ActionBrainDesktop: { isDesktop: "yes", onCallEnded() {}, onCallCancelled() {}, report() {} } };
  assert.equal(getDesktopBridge(), null);
});

test("the real helper object is used", () => {
  const bridge = { isDesktop: true, onCallEnded() {}, onCallCancelled() {}, report() {} };
  g.window = { ActionBrainDesktop: bridge };
  assert.equal(getDesktopBridge(), bridge);
});
