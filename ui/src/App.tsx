import { Outlet } from 'react-router';
import Layout from './components/Layout.js';

export default function App() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
