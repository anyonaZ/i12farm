import { titled } from '@/lib/titles';
import { LegalPage } from '@/components/LegalPage';
import { PRIVACY } from '@/content/legal';

export const generateMetadata = titled('privacy');

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
