import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { Boot } from "./app/Boot";
import { AppErrorBoundary } from "./app/ErrorPages";
import { routes } from "./app/routes";
import { SocketProvider } from "./lib/socket";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter(routes);

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Boot>
          <SocketProvider>
            <RouterProvider router={router} />
          </SocketProvider>
        </Boot>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
