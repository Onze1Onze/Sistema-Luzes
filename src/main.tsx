import React from "react";
import { createRoot } from "react-dom/client";
import OBR from "@owlbear-rodeo/sdk";
import App from "./App";
import { registerLightTool } from "./tools";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(<React.StrictMode><App /></React.StrictMode>);

OBR.onReady(() => {
  void registerLightTool().catch((error) => {
    console.error("[Sistema de Luzes] Não foi possível registrar a ferramenta:", error);
  });
});
