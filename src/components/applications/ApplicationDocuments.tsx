import React, { useMemo } from 'react';
import type { Application } from '../../types';
import { applicationService } from '../../services/applicationService';
import { DocumentList, type ListedDocument } from '../common/DocumentList';

interface Props {
  application: Pick<Application, 'documents' | 'resumeDataUrl' | 'resumeUrl' | 'resumeFileName'>;
  /** Tighter spacing for use inside cards. */
  compact?: boolean;
}

/** Applications submitted before document uploads existed may carry a single legacy resume link/data URL. */
function legacyDocument(app: Props['application']): ListedDocument | null {
  const url = app.resumeDataUrl || app.resumeUrl;
  if (!url || !/^(data:|https?:\/\/)/i.test(url)) return null;
  const name = app.resumeFileName || 'Resume.pdf';
  return { id: 'legacy-resume', fileName: name, fileType: /\.pdf$/i.test(name) ? 'application/pdf' : '', fileSize: 0, directUrl: url, label: 'CV / Primary document' };
}

/** CV + supporting documents attached to an application, for the hiring team and the applicant. */
export const ApplicationDocuments: React.FC<Props> = ({ application, compact }) => {
  const documents = useMemo<ListedDocument[]>(() => {
    if (application.documents && application.documents.length > 0) {
      return application.documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType,
        fileSize: d.fileSize,
        path: d.path,
        label: d.kind === 'cv' ? 'CV / Primary document' : 'Supporting document'
      }));
    }
    const legacy = legacyDocument(application);
    return legacy ? [legacy] : [];
  }, [application]);

  return (
    <DocumentList
      documents={documents}
      compact={compact}
      emptyText="No documents were attached to this application."
      resolveUrls={(docs) =>
        applicationService.getDocumentUrls(
          docs.map((d) => ({ id: d.id, kind: 'cv' as const, fileName: d.fileName, fileType: d.fileType, fileSize: d.fileSize, path: d.path! }))
        )
      }
    />
  );
};
