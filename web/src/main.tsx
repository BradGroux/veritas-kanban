import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { MantineRoot } from './theme/MantineRoot';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineRoot>
        <App />
      </MantineRoot>
    </QueryClientProvider>
  </React.StrictMode>
);
