import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);


// function promiseTest():Promise<void> {
// return new Promise((resolve, reject) => {
//   setTimeout(() => {
//     return 1;}