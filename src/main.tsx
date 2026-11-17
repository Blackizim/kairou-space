import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initDevToolsShield } from './security/devtoolsShield';

initDevToolsShield();

createRoot(document.getElementById('root')!).render(<App />);
