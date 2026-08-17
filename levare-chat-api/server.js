import express from "express";
import cors from "cors";
import "dotenv/config";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const PROJECT_ID = process.env.VOICEFLOW_PROJECT_ID;
const API_KEY = process.env.VOICEFLOW_API_KEY;
const ENVIRONMENT_ID = process.env.VOICEFLOW_ENVIRONMENT_ID || "main";

const sessions = new Map();

if (!PROJECT_ID) {
  console.error("VOICEFLOW_PROJECT_ID ontbreekt in .env");
  process.exit(1);
}

if (!API_KEY) {
  console.error("VOICEFLOW_API_KEY ontbreekt in .env");
  process.exit(1);
}

async function createVoiceflowSession(userID) {
  const url =
    `https://general-runtime.voiceflow.com/v4/project/` +
    `${encodeURIComponent(PROJECT_ID)}/environment/` +
    `${encodeURIComponent(ENVIRONMENT_ID)}/session`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userID
    })
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Voiceflow session error ${response.status}: ${text}`
    );
  }

  const data = await response.json();

  if (!data.sessionKey) {
    console.log("Voiceflow session response:", data);
    throw new Error("Geen sessionKey ontvangen van Voiceflow");
  }

  return data.sessionKey;
}

async function interact(sessionKey, action) {
  const response = await fetch(
    "https://general-runtime.voiceflow.com/v4/interact",
    {
      method: "POST",
      headers: {
        authorization: sessionKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Voiceflow interact error ${response.status}: ${text}`
    );
  }

  return await response.json();
}

function extractTextFromSlate(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  let result = "";

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;

    for (const node of nodes) {
      if (!node) continue;

      if (typeof node.text === "string") {
        result += node.text;
      }

      if (Array.isArray(node.children)) {
        walk(node.children);
      }
    }
  }

  walk(content);

  return result.trim();
}

function getTexts(response) {
  const traces = Array.isArray(response)
    ? response
    : response?.traces || [];

  const messages = [];

  for (const trace of traces) {
    if (!trace) continue;

    if (trace.type === "text") {
      const slateText = extractTextFromSlate(
        trace.payload?.slate?.content
      );

      if (slateText) {
        messages.push(slateText);
        continue;
      }

      const message =
        trace.payload?.message ||
        trace.payload?.text;

      if (message) {
        messages.push(String(message));
      }
    }

    if (trace.type === "speak") {
      const message =
        trace.payload?.message ||
        trace.payload?.text;

      if (message) {
        messages.push(String(message));
      }
    }
  }

  return messages;
}

async function getOrCreateSession(sessionID) {
  let session = sessions.get(sessionID);

  if (session) {
    return session;
  }

  const userID = `levare-${sessionID}`;

  const sessionKey = await createVoiceflowSession(userID);

  session = {
    sessionKey,
    launched: false,
    lastUsed: Date.now()
  };

  sessions.set(sessionID, session);

  return session;
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Levare Chat API"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online"
  });
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(
      req.body?.message || ""
    ).trim();

    let sessionID = String(
      req.body?.sessionID || ""
    ).trim();

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Geen bericht ontvangen"
      });
    }

    if (!sessionID) {
      sessionID = crypto.randomUUID();
    }

    let session = await getOrCreateSession(sessionID);

    /*
      Voiceflow launch uitvoeren bij een nieuwe sessie.
      De output hiervan bewaren we ook, want sommige bots
      geven bij launch al een begroeting terug.
    */

    let launchMessages = [];

    if (!session.launched) {
      const launchResponse = await interact(
        session.sessionKey,
        {
          type: "launch",
          payload: {}
        }
      );

      console.log(
        "VOICEFLOW LAUNCH:",
        JSON.stringify(launchResponse, null, 2)
      );

      launchMessages = getTexts(launchResponse);

      session.launched = true;
    }

    /*
      Gebruikersbericht naar Voiceflow sturen
    */

    const response = await interact(
      session.sessionKey,
      {
        type: "text",
        payload: message
      }
    );

    console.log(
      "VOICEFLOW RESPONSE:",
      JSON.stringify(response, null, 2)
    );

    const responseMessages = getTexts(response);

    const messages = [
      ...launchMessages,
      ...responseMessages
    ];

    session.lastUsed = Date.now();

    return res.json({
      success: true,
      sessionID,
      messages
    });

  } catch (error) {
    console.error(
      "CHAT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Chat kon niet worden verwerkt",
      detail: error.message
    });
  }
});

/*
  Oude sessies verwijderen na 6 uur
*/

setInterval(() => {
  const sixHoursAgo =
    Date.now() - 6 * 60 * 60 * 1000;

  for (const [sessionID, session] of sessions) {
    if (session.lastUsed < sixHoursAgo) {
      sessions.delete(sessionID);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(
    `Levare API draait op poort ${PORT}`
  );
});