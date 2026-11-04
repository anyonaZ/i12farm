import { LegalPage } from '@/components/LegalPage';
import { TERMS } from '@/content/legal';

export const metadata = { title: 'Terms of use' };

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
