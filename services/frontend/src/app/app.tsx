import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "../routes";

// One QueryClient for the whole app's lifetime — created outside the
// component so it survives re-renders (a `new QueryClient()` inside `App`
// would reset every cache on every render).
const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
