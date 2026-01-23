
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, Footer, PageBreak } from "docx";
import JSZip from 'jszip';
import { generateSceneImage } from './geminiService';
import { Comment } from '../types';

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; 
  a.download = name; 
  a.click();
  URL.revokeObjectURL(url);
};

export const exportDraft = async (
  format: 'txt' | 'docx' | 'pdf' | 'md' | 'epub',
  title: string,
  content: string,
  comments: Comment[],
  setStatus: (s: string) => void
) => {
  const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'lumina-draft'}`;

  try {
    if (format === 'epub') {
        setStatus('Building eBook...');
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');
        zip.folder('META-INF')!.file('container.xml', `<?xml version="1.0"?>
          <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
            <rootfiles>
              <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
          </container>`);
          
        const oebps = zip.folder('OEBPS');
        oebps!.file('content.opf', `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>${title}</dc:title>
            <dc:language>en</dc:language>
          </metadata>
          <manifest>
            <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
            <item href="chapter1.xhtml" id="chapter1" media-type="application/xhtml+xml"/>
          </manifest>
          <spine toc="ncx">
            <itemref idref="chapter1"/>
          </spine>
        </package>`);

        oebps!.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
          <head><meta content="urn:uuid:12345" name="dtb:uid"/></head>
          <docTitle><text>${title}</text></docTitle>
          <navMap>
            <navPoint id="navPoint-1" playOrder="1">
              <navLabel><text>Start</text></navLabel>
              <content src="chapter1.xhtml"/>
            </navPoint>
          </navMap>
        </ncx>`);

        oebps!.file('chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>${title}</title></head>
        <body>
          <h1>${title}</h1>
          ${content.split('\n').map(p => `<p>${p}</p>`).join('')}
        </body>
        </html>`);

        const blob = await zip.generateAsync({type: "blob"});
        downloadBlob(blob, `${filename}.epub`);

    } else if (format === 'pdf') {
        setStatus('Designing Cover...');
        const doc = new jsPDF();
        
        // AI Generated Cover
        try {
          const coverPrompt = `A minimal, artistic book cover for a memoir chapter titled "${title}". B&W, woodcut style, highly detailed.`;
          const base64Cover = await generateSceneImage(coverPrompt);
          if (base64Cover) {
            doc.addImage(`data:image/png;base64,${base64Cover}`, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
            
            // Add Title on Cover
            doc.setFont("times", "bold");
            doc.setFontSize(32);
            doc.setTextColor(255, 255, 255);
            doc.text(title, 105, 100, { align: 'center' });
            
            doc.setTextColor(0, 0, 0); // Reset
            doc.addPage();
          }
        } catch (e) { console.error("Cover Gen Failed", e); }

        setStatus('Typesetting...');
        doc.setFont("times", "normal");
        doc.setFontSize(12);
        
        const lines = doc.splitTextToSize(content, 170);
        let cursorY = 30;
        let pageNum = 1;

        // Title on first text page
        doc.setFont("times", "bold");
        doc.setFontSize(18);
        doc.text(title, 105, 20, { align: 'center' });
        doc.setFont("times", "normal");
        doc.setFontSize(12);
        
        lines.forEach((line: string) => {
          if (cursorY > 270) {
            doc.setFontSize(10);
            doc.text(`${pageNum}`, 105, 290, { align: 'center' });
            doc.setFontSize(12);
            doc.addPage();
            cursorY = 20;
            pageNum++;
          }
          doc.text(line, 20, cursorY);
          cursorY += 7;
        });

        if (comments.length > 0) {
            doc.addPage();
            doc.setFont("times", "bold");
            doc.setFontSize(16);
            doc.text("Margin Notes", 20, 20);
            doc.setFont("times", "normal");
            doc.setFontSize(10);
            cursorY = 35;
            comments.forEach(c => {
                if (cursorY > 270) {
                    doc.addPage();
                    cursorY = 20;
                }
                const note = `[${new Date(c.timestamp).toLocaleTimeString()}] Ref: "${c.originalText.substring(0, 30)}..."\nNote: ${c.text}`;
                const splitNote = doc.splitTextToSize(note, 170);
                doc.text(splitNote, 20, cursorY);
                cursorY += (splitNote.length * 5) + 10;
            });
        }
        
        doc.setFontSize(10);
        doc.text(`${pageNum}`, 105, 290, { align: 'center' });

        doc.save(`${filename}.pdf`);

    } else if (format === 'docx') {
        setStatus('Packaging Doc...');
        
        const children = [
            new Paragraph({
                text: title,
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            }),
            ...content.split('\n').map(l => new Paragraph({ 
                children: [new TextRun({ text: l, size: 24, font: "Times New Roman" })],
                spacing: { after: 200 }
            }))
        ];

        if (comments.length > 0) {
            children.push(new Paragraph({ 
                text: "Margin Notes", 
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true
            }));
            comments.forEach(c => {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: `[${new Date(c.timestamp).toLocaleTimeString()}] `, bold: true }),
                        new TextRun({ text: `"${c.originalText}"`, italics: true }),
                        new TextRun({ text: ` - ${c.text}` })
                    ],
                    spacing: { after: 120 }
                }));
            });
        }

        const doc = new Document({ 
          sections: [{ 
            properties: {
              page: {
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
              },
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({ text: `Created with Lumina AI • ${new Date().getFullYear()}`, size: 16, color: "888888" })
                    ],
                  }),
                ],
              }),
            },
            children: children
          }] 
        });
        const blob = await Packer.toBlob(doc);
        downloadBlob(blob, `${filename}.docx`);

    } else if (format === 'md') {
        let mdContent = `# ${title}\n\n${content}`;
        if (comments.length > 0) {
            mdContent += `\n\n## Margin Notes\n\n${comments.map(c => `- **${c.originalText}**: ${c.text}`).join('\n')}`;
        }
        const blob = new Blob([mdContent], { type: 'text/markdown' });
        downloadBlob(blob, `${filename}.md`);

    } else {
        // Text
        let txtContent = content;
        if (comments.length > 0) {
            txtContent += `\n\n--- MARGIN NOTES ---\n${comments.map(c => `[${new Date(c.timestamp).toLocaleTimeString()}] "${c.originalText}": ${c.text}`).join('\n')}`;
        }
        const blob = new Blob([txtContent], { type: 'text/plain' });
        downloadBlob(blob, `${filename}.txt`);
    }
  } catch (e) {
      console.error("Export failed", e);
      throw e;
  }
};
