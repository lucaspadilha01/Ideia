// Simula `claude -p --output-format stream-json` para testes. Lê o prompt do stdin.
let input = "";
process.stdin.setEncoding("utf8").on("data", (c) => (input += c)).on("end", () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  if (input.includes("SLEEP")) return void setTimeout(() => {}, 60000);
  out({ type: "system", subtype: "init" });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "olá " } } });
  out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.txt" } }] } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "mundo" } } });
  out({ type: "result", result: `eco: ${input.trim()} | args: ${process.argv.slice(2).join(" ")}`, is_error: false, total_cost_usd: 0.01 });
});
