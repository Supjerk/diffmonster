import React from 'react';
import { InputGroup, Classes } from '@blueprintjs/core';
import FuzzySearch from 'fuzzaldrin-plus';
import { makeTree } from '../lib/FileTree';
import { Tree } from './Tree';
import Styles from './FileTree.module.css';

const ICON_NAME_BY_STATUS = {
  added: 'add',
  removed: 'delete',
  renamed: 'circle-arrow-right',
};

class FileTree extends React.Component {
  state = {
    query: '',
    tree: makeTree(this.props.files),
    collapsed: {},
  };

  componentWillReceiveProps(nextProps) {
    if (this.props.files !== nextProps.files)
      this.setState({ tree: this._getTree(nextProps.files, this.state.query) });
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.query !== this.state.query) {
      this._scrollEl.scrollTop = 0;
    }
  }

  render() {
    return (
      <div className={Styles.Container}>
        <div className={Styles.SearchWrapper}>
          <InputGroup
            autoComplete="off"
            leftIconName="search"
            placeholder="Search..."
            type="search"
            value={this.state.query}
            onChange={this._search}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }} ref={el => this._scrollEl = el}>
          <Tree
            contents={this.state.query ?
              this._renderFilteredTree(this.state.tree) :
              this._renderTree(this.state.tree)}
            onNodeClick={this._onNodeClick}
            onNodeExpand={this._onNodeClick}
            onNodeCollapse={this._onNodeClick}
          />
        </div>
      </div>
    );
  }

  _renderFilteredTree(tree) {
    const nodes = [];
    for (let file of tree) {
      const path = file.filename;
      const basename = path.split('/').pop();
      const basenameOffset = path.length - basename.length;
      const dir = path.substring(0, basenameOffset);
      const matches = FuzzySearch.match(path, this.state.query);
      nodes.push({
        id: path,
        iconName: ICON_NAME_BY_STATUS[file.status],
        className: Styles.FilteredTreeNode,
        label: [
          this._highlightMatch(basename, matches, basenameOffset),
          <div key="dir" className={`${Classes.TEXT_OVERFLOW_ELLIPSIS} ${Styles.Dir}`}>
            {this._highlightMatch(dir, matches, 0)}
          </div>
        ],
        isSelected: this.props.activePath === path,
        secondaryLabel: this._renderSecondaryLabel(file),
      });
    }
    return nodes;
  }

  _renderTree(tree, prefix = '') {
    const nodes = [];
    for (let dir of Object.keys(tree.dirs)) {
      const subtree = tree.dirs[dir];
      const subPrefix = prefix + '/' + subtree.name;
      nodes.push({
        id: subPrefix,
        label: subtree.name,
        childNodes: this._renderTree(subtree, subPrefix),
        isExpanded: !this.state.collapsed[subPrefix],
      });
    }
    if (tree.files) {
      for (let file of tree.files) {
        const path = file.filename;
        const basename = path.split('/').pop();
        nodes.push({
          id: path,
          iconName: ICON_NAME_BY_STATUS[file.status],
          label: basename,
          isSelected: this.props.activePath === path,
          secondaryLabel: this._renderSecondaryLabel(file),
        });
      }
    }
    return nodes;
  }

  _renderSecondaryLabel(file) {
    if (!file.isReviewed && file.commentCount > 0) {
      return <span className="pt-icon-standard pt-icon-comment" />;
    } else if (file.isReviewed) {
      return <span className="pt-icon-standard pt-icon-small-tick" />;
    } else {
      return null;
    }
  }

  _getTree(files, query) {
    return query ? FuzzySearch.filter(files, query, { key: 'filename' }) : makeTree(files);
  }

  _highlightMatch(path, matches, offsetIndex) {
    // Similar to https://github.com/atom/fuzzy-finder/blob/cf40851/lib/fuzzy-finder-view.js
    let lastIndex = 0
    let matchedChars = []
    const fragment = []
    for (let matchIndex of matches) {
      matchIndex -= offsetIndex
      // If marking up the basename, omit path matches
      if (matchIndex < 0) {
        continue
      }
      const unmatched = path.substring(lastIndex, matchIndex)
      if (unmatched) {
        if (matchedChars.length > 0) {
          const joined = matchedChars.join('');
          if (joined)
            fragment.push(<b key={matchIndex}>{joined}</b>)
          matchedChars = []
        }

        fragment.push(unmatched)
      }

      matchedChars.push(path[matchIndex])
      lastIndex = matchIndex + 1
    }

    if (matchedChars.length > 0) {
      const joined = matchedChars.join('');
      if (joined)
        fragment.push(<b key="last">{joined}</b>)
    }

    // Remaining characters are plain text
    const last = path.substring(lastIndex)
    if (last)
      fragment.push(last)
    return fragment
  }

  _onNodeClick = node => {
    if (node.childNodes) {
      // dir node
      const isExpanded = node.isExpanded;
      this.setState(({ collapsed }) => {
        if (isExpanded)
          collapsed[node.id] = true;
        else
          delete collapsed[node.id];
        return { collapsed };
      });
    } else {
      // file node
      if (!node.isSelected) {
        this.props.onSelectFile(node.id);
      }
    }
  };

  _search = event => {
    const query = event.target.value;
    this.setState({
      query,
      tree: this._getTree(this.props.files, query),
    });
  };
}

export default FileTree;
