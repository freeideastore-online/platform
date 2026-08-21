import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

function consoleBasename() {
  return "/console";
}

export default function App() {
  return (
    <BrowserRouter basename={consoleBasename()}>
      <Routes>
        <Route index element={<div>FreeIdeaStore idea console</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
