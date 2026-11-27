import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import ServiceWorkerRegister from "./ServiceWorkerRegister";
import { AuthProvider } from "./context";
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><BrowserRouter><AuthProvider><ServiceWorkerRegister/><App /></AuthProvider></BrowserRouter></React.StrictMode>
);
