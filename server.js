import express from "express";
import neo4j from "neo4j-driver";

const app = express();
app.use(express.static("public"));

const NEO4J_URI = process.env.NEO4J_URI;     // neo4j+s://xxxx.databases.neo4j.io
const NEO4J_USER = process.env.NEO4J_USER;   // обычно neo4j
const NEO4J_PASS = process.env.NEO4J_PASS;
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || "neo4j";

if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASS) {
  console.error("Missing env vars. Set: NEO4J_URI, NEO4J_USER, NEO4J_PASS (optional: NEO4J_DATABASE)");
  process.exit(1);
}

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASS),
  {
    // пусть числа остаются числами, но мы НЕ используем внутренние id() как идентификаторы
    disableLosslessIntegers: true,
  }
);

// маленькая проверка при старте (полезно на Render)
(async () => {
  try {
    await driver.verifyConnectivity();
    console.log("Neo4j connectivity: OK");
  } catch (e) {
    console.error("Neo4j connectivity: FAILED", e);
  }
})();

/**
 * GET /api/graph
 * Возвращает { elements: [...] } для Cytoscape.js
 *
 * nodes:
 *  - kind=system, label=s.name, dataAttributes = имена Attribute по CONTAINS
 *
 * edges:
 *  - kind=flow, label=DATA_FLOW, mappings = r.mappings
 */
app.get("/api/graph", async (req, res) => {
  const session = driver.session({ database: NEO4J_DATABASE });
  try {
    const q = `
      // 1) Systems + attributes (CONTAINS)
      MATCH (s:System)
      OPTIONAL MATCH (s)-[:CONTAINS]->(a:Attribute)
      WITH s, collect(DISTINCT a.name) AS attrs

      // 2) Flows between systems
      OPTIONAL MATCH (s)-[r:DATA_FLOW]->(t:System)

      RETURN
        collect(DISTINCT {
          key: coalesce(s.id, elementId(s)),     // стабильный id (если s.id нет, берём elementId)
          label: coalesce(s.name, s.label, 'System'),
          attrs: attrs
        }) AS systems,

        collect(DISTINCT {
          key: CASE
                 WHEN r IS NULL THEN NULL
                 ELSE coalesce(r.id, elementId(r))  // стабильный id для ребра
               END,
          sourceKey: CASE WHEN r IS NULL THEN NULL ELSE coalesce(s.id, elementId(s)) END,
          targetKey: CASE WHEN r IS NULL THEN NULL ELSE coalesce(t.id, elementId(t)) END,
          mappings: CASE WHEN r IS NULL THEN [] ELSE coalesce(r.mappings, []) END
        }) AS flows
    `;

    const result = await session.run(q);
    if (!result.records.length) return res.json({ elements: [] });

    const row = result.records[0];
    const systems = row.get("systems") || [];
    const flows = row.get("flows") || [];

    const elements = [];

    for (const s of systems) {
      elements.push({
        data: {
          id: String(s.key),
          kind: "system",
          label: s.label,
          dataAttributes: Array.isArray(s.attrs) ? s.attrs : []
        }
      });
    }

    for (const f of flows) {
      if (!f || !f.key) continue; // нет ребра
      elements.push({
        data: {
          id: "f:" + String(f.key),
          kind: "flow",
          label: "DATA_FLOW",
          source: String(f.sourceKey),
          target: String(f.targetKey),
          mappings: Array.isArray(f.mappings) ? f.mappings : []
        }
      });
    }

    res.json({ elements });
  } catch (e) {
    console.error("API /api/graph error:", e);
    res.status(500).json({ error: String(e) });
  } finally {
    await session.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

// корректное завершение (Render любит это)
process.on("SIGINT", async () => { try { await driver.close(); } finally { process.exit(0); } });
process.on("SIGTERM", async () => { try { await driver.close(); } finally { process.exit(0); } });