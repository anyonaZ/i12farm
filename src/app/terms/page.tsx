import { titled } from '@/lib/titles';
import { LegalPage } from '@/components/LegalPage';
import { TERMS } from '@/content/legal';

export const generateMetadata = titled('terms');

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
