import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.27-resilience] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.27-resilience] patched ${rel}`);
}

export function applyV227ResiliencePatch(root = process.cwd()) {
  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;

    if (!text.includes('import { runIndependentCouncil } from "./agent-entity-runtime";')) {
      fail("Independent Council import is missing");
    }
    if (!text.includes("await runIndependentCouncil(snapshot, {")) {
      fail("Autonomous scanner is not using the independent Council");
    }

    const oldCatch = `  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state().lastError = message;
    addChat("System", \`Autonomous cycle error: \${message}\`, "system");
    console.error("[autopilot] cycle failed", error);
  } finally {`;
    const newCatch = `  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = state();
    const nowMs = Date.now();
    const sameMessage = globalState.__botWarRoomLastErrorMessageV227 === message;
    const lastAt = globalState.__botWarRoomLastErrorAtV227 ?? 0;
    current.lastError = message;
    // Never flood the Council chat with the same infrastructure error every scan.
    if (!sameMessage || nowMs - lastAt >= 60_000) {
      addChat("System", \`Autonomous cycle error: \${message}\`, "system");
      globalState.__botWarRoomLastErrorMessageV227 = message;
      globalState.__botWarRoomLastErrorAtV227 = nowMs;
    }
    console.error("[autopilot] cycle failed", error);
  } finally {`;
    if (text.includes(oldCatch)) text = text.replace(oldCatch, newCatch);

    text = text.replaceAll(
      "V2.26 Independent Entity Council started.",
      "V2.27 Local Independent Council started. No OpenAI/ChatGPT API calls. PAPER kill switches OFF."
    );
    text = text.replaceAll(
      "V2.25 Early Runner Core started.",
      "V2.27 Local Independent Council started. No OpenAI/ChatGPT API calls. PAPER kill switches OFF."
    );
    text = text.replaceAll(
      "V2.14 Runner Genome research council started.",
      "V2.27 Local Independent Council started. No OpenAI/ChatGPT API calls. PAPER kill switches OFF."
    );

    return text;
  });

  console.log("[v2.27-resilience] OpenAI removed from Council runtime; repeated infrastructure errors are rate-limited instead of flooding chat.");
}
