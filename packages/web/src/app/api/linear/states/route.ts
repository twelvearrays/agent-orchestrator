import { NextResponse } from "next/server";
import { request as httpsRequest } from "node:https";

interface LinearState {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface LinearTeam {
  id: string;
  name: string;
  states: { nodes: LinearState[] };
}

interface LinearTeamsResponse {
  data?: {
    teams: { nodes: LinearTeam[] };
  };
  errors?: Array<{ message: string }>;
}

function fetchLinearTeams(apiKey: string): Promise<LinearTeamsResponse> {
  const query = `{ teams { nodes { id name states { nodes { id name type color } } } } }`;
  const body = JSON.stringify({ query });

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    const req = httpsRequest(
      {
        hostname: "api.linear.app",
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", (err: Error) => settle(() => reject(err)));
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          settle(() => {
            try {
              const text = Buffer.concat(chunks).toString("utf-8");
              resolve(JSON.parse(text) as LinearTeamsResponse);
            } catch (err) {
              reject(err);
            }
          });
        });
      },
    );

    req.setTimeout(15_000, () => {
      settle(() => { req.destroy(); reject(new Error("Linear API timed out")); });
    });
    req.on("error", (err) => settle(() => reject(err)));
    req.write(body);
    req.end();
  });
}

export async function GET() {
  const apiKey = process.env["LINEAR_API_KEY"];
  if (!apiKey) {
    return NextResponse.json({ teams: [] });
  }

  try {
    const response = await fetchLinearTeams(apiKey);
    if (response.errors && response.errors.length > 0) {
      return NextResponse.json({ teams: [], error: response.errors[0]?.message });
    }
    const teams = (response.data?.teams.nodes ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      states: team.states.nodes,
    }));
    return NextResponse.json({ teams });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ teams: [], error: message });
  }
}
