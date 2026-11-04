/**
 * The practice desk lives at /student-dashboard. This address stays for old links (Phase 10, P10-31).
 */
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/student-dashboard', permanent: false },
});

export default function DemoTradingRedirect() {
  return null;
}
