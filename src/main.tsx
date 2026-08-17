import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { AppErrorBoundary } from "./components/error/AppErrorBoundary";
import { AppFailureWindow } from "./components/error/AppFailureWindow";
import { conversionActivity } from "./lib/conversionActivity";
import { rememberedQueueItems } from "./lib/queueSession";
import { installGlobalFailureHandlers } from "./lib/runtimeFailures";
import { initializeTheme } from "./lib/theme";

initializeTheme();
installGlobalFailureHandlers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary
      renderFallback={(failure) => (
        <AppFailureWindow
          failure={failure}
          activity={conversionActivity(rememberedQueueItems())}
          onReload={() => window.location.reload()}
        />
      )}
    >
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
