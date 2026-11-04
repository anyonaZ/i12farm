import { LegalPage } from '@/components/LegalPage';
import { PRIVACY } from '@/content/legal';

export const metadata = { title: 'Privacy notice' };

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
