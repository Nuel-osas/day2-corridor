import { createRoot } from 'react-dom/client';
import App from './App';
import { WalletProvider } from './lib/wallets';
import './styles.css';

createRoot(document.getElementById('root')!).render(
	<WalletProvider>
		<App />
	</WalletProvider>,
);
