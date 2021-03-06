import React, { ReactNode } from 'react';
import { highlight, getLanguage, ICompiledMode } from "highlight.js";
import "highlight.js/styles/default.css";
import { LineType, DiffFile, DiffBlock } from '../lib/DiffParser';
import { highlightDiff } from '../lib/DiffHighlight';
import CommentThread from './CommentThread';
import CommentComposer from './CommentComposer';
import Styles from './Diff.module.css';
import { PullRequestCommentDTO } from '../lib/Github';
import { Icon } from '@blueprintjs/core';

const CUSTOM_LANGUAGE_ALIASES: {[key: string]: string} = {
  // https://github.com/isagalaev/highlight.js/pull/1651
  kt: 'kotlin',
};

const LineTypeComponents = {
  [LineType.CONTEXT]: {
    LineRow: Styles.ContextLineRow,
    ContentCell: Styles.BaseContentCell,
  },
  [LineType.DELETION]: {
    LineRow: Styles.DeletionLineRow,
    ContentCell: Styles.DeletionContentCell,
    Highlight: Styles.DeletionHighlight,
  },
  [LineType.ADDITION]: {
    LineRow: Styles.AdditionLineRow,
    ContentCell: Styles.AdditionContentCell,
    Highlight: Styles.AdditionHighlight,
  },
};

class Highlighter {
  private oldStack: ICompiledMode | undefined;
  private newStack: ICompiledMode | undefined;

  constructor(private lang: string) {
    this.oldStack = undefined;
    this.newStack = undefined;
  }

  highlight(code: string, lineType: string) {
    const stack = lineType === LineType.DELETION ? this.oldStack : this.newStack;
    const result = highlight(this.lang, code, false, stack);
    if (lineType === LineType.DELETION) {
      this.oldStack = result.top;
    } else if (lineType === LineType.ADDITION) {
      this.newStack = result.top;
    } else {
      this.oldStack = this.newStack = result.top;
    }
    return result.value;
  }
}

function detectFileLanguage(file: DiffFile) {
  let lang = CUSTOM_LANGUAGE_ALIASES[file.language] || file.language;
  if (getLanguage(lang)) {
    return lang;
  }
  return null;
}

interface HunkProps {
  hunk: DiffBlock;
  file: DiffFile;
  commentsByPosition: {[key: number]: PullRequestCommentDTO[]};
  pendingCommentsByPosition: {[key: number]: PullRequestCommentDTO[]};
  language: string | null;
  canCreateComment: boolean;
  commentComposerPosition: number;
  onOpenCommentComposer(position: number): void;
  onCloseCommentComposer(): void;
  deleteComment(comment: PullRequestCommentDTO): void;
}

class Hunk extends React.Component<HunkProps> {
  render() {
    const {
      hunk,
      file,
      commentsByPosition,
      pendingCommentsByPosition,
      language,
      canCreateComment,
      commentComposerPosition,
      onCloseCommentComposer,
      deleteComment,
    } = this.props;
    const lines: ReactNode[] = [];
    const highlighter = language ? new Highlighter(language) : null;
    highlightDiff(hunk).forEach(line => {
      const C = LineTypeComponents[line.type];
      lines.push(
        <tr className={C.LineRow} key={'L' + line.position}>
          {canCreateComment &&
            <td className={Styles.AddCommentCell} onClick={() => this.props.onOpenCommentComposer(line.position)}>
              <Icon icon="comment" className={Styles.AddCommentIcon} />
            </td>}
          <td className={Styles.LineNumberCell}>{line.oldNumber || ''}</td>
          <td className={Styles.LineNumberCell}>{line.newNumber || ''}</td>
          <td className={C.ContentCell}>
          {line.content.map((span, spanIndex) => {
            const props: any = {
              key: spanIndex,
            };
            let content = span.content;
            if (spanIndex === line.content.length - 1)
              content += '\n';
            if (highlighter)
              props.dangerouslySetInnerHTML = {__html: highlighter.highlight(content, line.type)};
            else
              props.children = content;
            return span.highlight ?
              <span className={C.Highlight} {...props} />
              : <span {...props} />;
          })}
          </td>
        </tr>
      );
      const comments = commentsByPosition[line.position];
      const pendingComments = pendingCommentsByPosition[line.position];
      const showComposer = line.position === commentComposerPosition;
      if (comments || pendingComments || showComposer) {
        lines.push(
          <tr key={'C' + line.position}>
            <td colSpan={canCreateComment ? 4 : 3} style={{padding: 0}}>
              <div className={Styles.CommentContainer}>
                {comments && <CommentThread
                  comments={comments}
                  isPending={false}
                  deleteComment={deleteComment}
                />}
                {pendingComments && <CommentThread
                  comments={pendingComments}
                  isPending={true}
                  deleteComment={deleteComment}
                />}
                {showComposer && <CommentComposer
                  file={file}
                  position={line.position}
                  onCloseComposer={onCloseCommentComposer}
                />}
              </div>
            </td>
          </tr>
        );
      }
    });
    return (
      <tbody className={Styles.HunkGroup}>{lines}</tbody>
    );
  }
}

function collectCommentsByPosition(comments: PullRequestCommentDTO[]) {
  const commentsByPosition: {[key: number]: PullRequestCommentDTO[]} = {};
  comments.forEach(comment => {
    if (comment.position) {
      if (!commentsByPosition[comment.position])
        commentsByPosition[comment.position] = [];
      commentsByPosition[comment.position].push(comment);
    }
  });
  return commentsByPosition;
}

export interface DiffProps {
  file: DiffFile;
  comments: PullRequestCommentDTO[];
  pendingComments: PullRequestCommentDTO[];
  canCreateComment: boolean;
  deleteComment(comment: PullRequestCommentDTO): void;
}

export default class Diff extends React.Component<DiffProps> {
  state = {
    commentComposerPosition: -1,
  };

  componentWillReceiveProps(nextProps: DiffProps) {
    if (this.props.file.sha !== nextProps.file.sha) {
      this._closeCommentComposer();
    }
  }

  render() {
    const { file, comments, pendingComments, canCreateComment, deleteComment } = this.props;
    const commentsByPosition = collectCommentsByPosition(comments);
    const pendingCommentsByPosition = collectCommentsByPosition(pendingComments);

    const colSpan = canCreateComment ? 4 : 3;

    const items = [];
    const language = detectFileLanguage(file);
    for (var i = 0; i < file.blocks.length; i++) {
      const hunk = file.blocks[i];
      items.push(
        <thead key={'H' + i}>
          <tr className={Styles.HunkHeaderRow}>
            <td style={{paddingTop: i > 0 ? '16px' : 0}} colSpan={colSpan}>
              {hunk.header}
            </td>
          </tr>
        </thead>
      );
      items.push(
        <Hunk
          key={'L' + i}
          file={file}
          hunk={hunk}
          commentsByPosition={commentsByPosition}
          pendingCommentsByPosition={pendingCommentsByPosition}
          language={language}
          canCreateComment={canCreateComment}
          commentComposerPosition={this.state.commentComposerPosition}
          onOpenCommentComposer={this._openCommentComposer}
          onCloseCommentComposer={this._closeCommentComposer}
          deleteComment={deleteComment}
        />
      );
    }

    return (
      <table className={Styles.DiffTable}>{items}</table>
    );
  }

  _openCommentComposer = (position: number) => {
    this.setState({ commentComposerPosition: position });
  };

  _closeCommentComposer = () => {
    this.setState({ commentComposerPosition: -1 });
  };
}
