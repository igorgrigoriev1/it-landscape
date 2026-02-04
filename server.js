import express from "express";
import neo4j from "neo4j-driver";

const app = express();
app.use(express.static("public"));

const NEO4J_URI = process.env.NEO4J_URI;     // neo4j+s://xxxx.databases.neo4j.io
const NEO4J_USER = process.env.NEO4J_USER;   // обычно neo4j
const NEO4J_PASS = process.env.NEO4J_PASS;

if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASS) {
  console.error("Missing env vars. Set: NEO4J_URI, NEO4J_USER, NEO4J_PASS");
  process.exit(1);
}

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASS),
  { disableLosslessIntegers: true }
);

/**
 * API: /api/graph
 * Возвращает элементы Cytoscape.js:
 * - nodes: System с dataAttributes (из s.attributes)
 * - edges: DATA_FLOW с mappings (из r.mappings)
 */
app.get("/api/graph", async (req, res) => {
  const session = driver.session();
  try {
    const q = `
      MATCH (s:System)
      OPTIONAL MATCH (s)-[r:DATA_FLOW]->(t:System)
      RETURN
        collect(DISTINCT {
          id: id(s),
          label: s.name,
          attributes: coalesce(s.attributes, [])
        }) AS systems,
        collect(DISTINCT {
          id: id(r),
          source: id(s),
          target: id(t),
          mappings: coalesce(r.mappings, [])
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
          id: String(s.id),
          kind: "system",
          label: s.label || `System ${s.id}`,
          dataAttributes: Array.isArray(s.attributes) ? s.attributes : []
        }
      });
    }

    for (const f of flows) {
      // если нет отношений — Neo4j вернёт одну "пустую" запись; фильтруем
      if (f.id === null || f.id === undefined) continue;

      elements.push({
        data: {
          id: "e" + String(f.id),
          kind: "flow",
          label: "DATA_FLOW",
          source: String(f.source),
          target: String(f.target),
          mappings: Array.isArray(f.mappings) ? f.mappings : []
        }
      });
    }

    res.json({ elements });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await session.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
