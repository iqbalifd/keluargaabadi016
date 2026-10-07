import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let familyData = []; 
let nextId = 1; 
let selectedNodeId = null; 
let activeSpouseIndices = {}; 
let isolatedParentId = null; 
let isolatedSpouseIndex = null; 
let collapsedNodeIds = {}; 
let isFirstLoad = true;

const container = document.getElementById('tree-container');
const baseRectWidth = 200; // Diperbesar dari 180 agar muat nama/gelar panjang
const rectHeight = 72;
const coupleGap = 24; // Jarak antar kotak pasangan diperluas

const svg = d3.select("#tree-container").append("svg")
    .attr("width", "100%")
    .attr("height", "100%");

const defs = svg.append("defs");

const filter = defs.append("filter").attr("id", "drop-shadow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
filter.append("feDropShadow").attr("dx", "0").attr("dy", "5").attr("stdDeviation", "6").attr("flood-opacity", "0.15");

const filterActive = defs.append("filter").attr("id", "drop-shadow-active").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
filterActive.append("feDropShadow").attr("dx", "0").attr("dy", "8").attr("stdDeviation", "10").attr("flood-color", "#2563eb").attr("flood-opacity", "0.5");

const gradMain = defs.append("linearGradient").attr("id", "grad-main").attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "100%");
gradMain.append("stop").attr("offset", "0%").attr("stop-color", "#3b82f6"); 
gradMain.append("stop").attr("offset", "100%").attr("stop-color", "#1d4ed8"); 

const gradSpouse = defs.append("linearGradient").attr("id", "grad-spouse").attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "100%");
gradSpouse.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff");
gradSpouse.append("stop").attr("offset", "100%").attr("stop-color", "#f1f5f9"); 

const g = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.1, 3]).on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom);

// Pengaturan layout diperlebar agar tidak saling bertabrakan
const treeLayout = d3.tree()
    .nodeSize([baseRectWidth * 2.2, rectHeight + 140])
    .separation((a, b) => a.parent == b.parent ? 1.1 : 1.4);

function calculateBoxWidth(name) {
    if (!name) return baseRectWidth;
    const approxWidth = name.length * 7.5 + 40;
    return Math.max(baseRectWidth, approxWidth);
}

window.toggleCollapse = function(event, id) {
    event.stopPropagation(); 
    collapsedNodeIds[id] = !collapsedNodeIds[id];
    updateTree();
    showToast(collapsedNodeIds[id] ? "Cabang keturunan dilipat" : "Cabang keturunan dibuka");
};

function getChildIndexLabel(nodeData) {
    if (!nodeData.parentId) return ""; 
    const mySpouseIdx = nodeData.parentSpouseIndex !== undefined ? nodeData.parentSpouseIndex : 0;
    
    const sameMotherSiblings = familyData.filter(n => {
        if (n.parentId !== nodeData.parentId) return false;
        const sIdx = n.parentSpouseIndex !== undefined ? n.parentSpouseIndex : 0;
        return sIdx === mySpouseIdx;
    });

    const index = sameMotherSiblings.findIndex(n => n.id === nodeData.id);
    if (index !== -1) {
        return `Anak ke-${index + 1} (Istri ${mySpouseIdx + 1})`;
    }
    return "";
}

function updateTree() {
    g.selectAll("*").remove();

    const emptyState = document.getElementById('empty-state');
    if (familyData.length === 0) {
        emptyState.style.display = 'block';
        return;
    } else {
        emptyState.style.display = 'none';
    }

    try {
        if (isFirstLoad) {
            familyData.forEach(n => {
                if (n.parentId) {
                    const parentNode = familyData.find(p => p.id === n.parentId);
                    if (parentNode && parentNode.parentId) {
                        collapsedNodeIds[n.parentId] = true;
                    }
                }
            });
            isFirstLoad = false;
        }

        let activeData = familyData;
        if (isolatedParentId) {
            const getSubtreeIds = (parentId, targetSpouseIdx) => {
                let ids = [parentId];
                const children = familyData.filter(n => {
                    if (n.parentId !== parentId) return false;
                    if (parentId === isolatedParentId && targetSpouseIdx !== null && targetSpouseIdx !== undefined) {
                        const sIdx = n.parentSpouseIndex !== undefined ? n.parentSpouseIndex : 0;
                        return sIdx === targetSpouseIdx;
                    }
                    return true;
                });
                for (const child of children) {
                    ids = ids.concat(getSubtreeIds(child.id, null));
                }
                return ids;
            };

            const validIds = getSubtreeIds(isolatedParentId, isolatedSpouseIndex);
            activeData = familyData.filter(n => validIds.includes(n.id)).map(n => {
                if (n.id === isolatedParentId) return { ...n, parentId: null }; 
                return { ...n };
            });
        }

        const hiddenIds = new Set();
        const getHiddenDescendantIds = (parentId) => {
            let hIds = [];
            const children = activeData.filter(n => n.parentId === parentId);
            for (const c of children) {
                hIds.push(c.id);
                hIds = hIds.concat(getHiddenDescendantIds(c.id));
            }
            return hIds;
        };

        for (const id in collapsedNodeIds) {
            if (collapsedNodeIds[id]) {
                getHiddenDescendantIds(id).forEach(hid => hiddenIds.add(hid));
            }
        }

        const filteredTreeData = activeData.filter(n => !hiddenIds.has(n.id));
        const root = d3.stratify().id(d => d.id).parentId(d => d.parentId)(filteredTreeData);
        treeLayout(root);

        g.selectAll(".link")
            .data(root.links())
            .enter().append("path")
            .attr("class", "link")
            .attr("d", d => {
                const startX = d.source.x;
                const startY = d.source.y + (rectHeight / 2); 
                const endX = d.target.x;
                const endY = d.target.y - (rectHeight / 2);   
                return `M${startX},${startY} C${startX},${(startY + endY) / 2} ${endX},${(startY + endY) / 2} ${endX},${endY}`;
            });

        const nodeGroup = g.selectAll(".node")
            .data(root.descendants())
            .enter().append("g")
            .attr("class", "node")
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .on("click", (event, d) => selectNode(d.data)); 

        nodeGroup.each(function(d) {
            const group = d3.select(this);
            const spouses = d.data.spouses || [];
            const activeIdx = activeSpouseIndices[d.data.id] || 0;
            const currentSpouse = spouses[activeIdx] || null;
            const hasSpouse = !!currentSpouse && !!currentSpouse.name;
            const isSelected = selectedNodeId === d.data.id;

            const mainWidth = calculateBoxWidth(d.data.name);
            const spouseWidth = hasSpouse ? calculateBoxWidth(currentSpouse.name) : 0;
            const mainX = hasSpouse ? -(mainWidth + (coupleGap/2)) : -(mainWidth / 2);
            
            group.append("rect")
                .attr("class", "node-rect node-main")
                .attr("x", mainX)
                .attr("y", -(rectHeight / 2))
                .attr("width", mainWidth)
                .attr("height", rectHeight)
                .attr("fill", "url(#grad-main)")
                .attr("filter", isSelected ? "url(#drop-shadow-active)" : "url(#drop-shadow)")
                .attr("stroke", isSelected ? "#ffffff" : "rgba(255,255,255,0.4)")
                .attr("stroke-width", isSelected ? "4px" : "1.5px");

            group.append("text")
                .attr("class", "text-main-name")
                .attr("x", mainX + (mainWidth/2))
                .attr("y", -14)
                .attr("font-size", "14px")
                .text(d.data.name || "");

            let details = [];
            const childNumLabel = getChildIndexLabel(d.data);
            if (childNumLabel) details.push(childNumLabel);
            if (d.data.mainAlm) details.push("Alm.");
            if (d.data.birthYear) details.push(d.data.birthYear);

            group.append("text")
                .attr("class", "text-main-detail")
                .attr("x", mainX + (mainWidth/2))
                .attr("y", 10)
                .attr("font-size", "11px")
                .text(details.join(" • "));

            if (hasSpouse) {
                const spouseX = coupleGap / 2;

                group.append("line")
                    .attr("class", "couple-link")
                    .attr("x1", mainX + mainWidth)
                    .attr("y1", 0)
                    .attr("x2", spouseX)
                    .attr("y2", 0);

                group.append("rect")
                    .attr("class", "node-rect node-spouse")
                    .attr("x", spouseX)
                    .attr("y", -(rectHeight / 2))
                    .attr("width", spouseWidth)
                    .attr("height", rectHeight)
                    .attr("fill", "url(#grad-spouse)")
                    .attr("filter", isSelected ? "url(#drop-shadow-active)" : "url(#drop-shadow)")
                    .attr("stroke", isSelected ? "#2563eb" : "#cbd5e1")
                    .attr("stroke-width", isSelected ? "4px" : "1.5px");

                group.append("text")
                    .attr("class", "text-spouse-name")
                    .attr("x", spouseX + (spouseWidth/2))
                    .attr("y", -14)
                    .attr("font-size", "14px")
                    .text(currentSpouse.name || "");

                let spouseDetails = [];
                if (spouses.length > 1) spouseDetails.push(`Istri ${activeIdx + 1}/${spouses.length}`);
                if (currentSpouse.spouseAlm) spouseDetails.push("Alm.");
                if (currentSpouse.spouseBirthYear) spouseDetails.push(currentSpouse.spouseBirthYear);

                group.append("text")
                    .attr("class", "text-spouse-detail")
                    .attr("x", spouseX + (spouseWidth/2))
                    .attr("y", 10)
                    .attr("font-size", "11px")
                    .text(spouseDetails.join(" • "));
            }

            const hasChildren = familyData.some(n => n.parentId === d.data.id);
            if (hasChildren) {
                const isCollapsed = !!collapsedNodeIds[d.data.id];
                const btnGroup = group.append("g")
                    .attr("class", "collapse-btn")
                    .attr("transform", `translate(0, ${rectHeight / 2})`)
                    .on("click", (event) => toggleCollapse(event, d.data.id));

                btnGroup.append("circle")
                    .attr("r", 13)
                    .attr("fill", "#1e40af")
                    .attr("stroke", "#ffffff")
                    .attr("stroke-width", "2.5px");

                btnGroup.append("text")
                    .attr("text-anchor", "middle")
                    .attr("dy", "4px")
                    .attr("fill", "#ffffff")
                    .attr("font-size", "14px")
                    .attr("font-weight", "bold")
                    .text(isCollapsed ? "+" : "-");
            }
        });
    } catch (error) {
        console.error("Tree render error:", error);
    }
}

window.isolateFamilyView = function() {
    if (!selectedNodeId) return;
    const node = familyData.find(n => n.id === selectedNodeId);
    if (!node) return;

    isolatedParentId = node.id;
    isolatedSpouseIndex = activeSpouseIndices[node.id] || 0; 
    
    const spouses = node.spouses || [];
    const activeSpouseObj = spouses[isolatedSpouseIndex];
    const spouseNameDesc = activeSpouseObj && activeSpouseObj.name ? ` & ${activeSpouseObj.name}` : '';

    document.getElementById('filter-banner').classList.remove('hidden');
    document.getElementById('filter-banner-text').textContent = `Keluarga ${node.name}${spouseNameDesc}`;
    
    updateTree();
    resetView();
    showToast(`Menampilkan khusus keturunan ${node.name}`);
};

window.resetFamilyFilter = function() {
    isolatedParentId = null;
    isolatedSpouseIndex = null;
    document.getElementById('filter-banner').classList.add('hidden');
    updateTree();
    resetView();
    showToast("Kembali ke silsilah lengkap");
};

window.handleSearch = function(query) {
    const resultsBox = document.getElementById('search-results');
    if (!query.trim()) {
        resultsBox.classList.add('hidden');
        resultsBox.innerHTML = '';
        return;
    }

    const lowerQuery = query.toLowerCase();
    const matches = familyData.filter(n => {
        if (n.name && n.name.toLowerCase().includes(lowerQuery)) return true;
        if (n.birthYear && n.birthYear.toString().includes(lowerQuery)) return true;
        if (n.spouses && n.spouses.some(s => s.name && s.name.toLowerCase().includes(lowerQuery))) return true;
        return false;
    });

    if (matches.length === 0) {
        resultsBox.innerHTML = '<div class="p-4 text-sm text-gray-500 text-center font-bold">Nama tidak ditemukan</div>';
        resultsBox.classList.remove('hidden');
        return;
    }

    let html = '';
    matches.forEach(m => {
        let spouseSummary = '';
        if (m.spouses && m.spouses.length > 0) {
            const spouseNames = m.spouses.map(s => s.name).filter(Boolean).join(', ');
            if (spouseNames) spouseSummary = ` • Pasangan: ${spouseNames}`;
        }

        html += `<div onclick="focusNode('${m.id}')" class="p-3.5 hover:bg-blue-50 cursor-pointer border-b border-gray-100 text-sm transition-colors">
            <p class="font-extrabold text-blue-950">${m.name} ${m.birthYear ? '(' + m.birthYear + ')' : ''}</p>
            <p class="text-xs text-gray-600 font-medium">${spouseSummary}</p>
        </div>`;
    });
    resultsBox.innerHTML = html;
    resultsBox.classList.remove('hidden');
};

window.focusNode = function(id) {
    let curr = familyData.find(n => n.id === id);
    if (curr) {
        while (curr && curr.parentId) {
            collapsedNodeIds[curr.parentId] = false;
            curr = familyData.find(n => n.id === curr.parentId);
        }

        selectNode(familyData.find(n => n.id === id));
        document.getElementById('search-results').classList.add('hidden');
        document.getElementById('search-input').value = '';
        updateTree(); 

        const nodeGroup = d3.selectAll(".node").filter(d => d.data.id === id);
        if (!nodeGroup.empty()) {
            const bound = nodeGroup.node().getBoundingClientRect();
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            const currentTransform = d3.zoomTransform(svg.node());
            const targetX = currentTransform.x + (cw / 2) - (bound.left + bound.width / 2);
            const targetY = currentTransform.y + (ch / 2) - (bound.top + bound.height / 2);
            
            svg.transition().duration(500).call(
                zoom.transform,
                d3.zoomIdentity.translate(targetX, targetY).scale(currentTransform.k)
            );
        }
    }
};

let isMobilePanelOpen = true;
const uiPanel = document.getElementById('ui-panel');
let dragStartY = 0, panelCurrentY = 0, isDraggingPanel = false, panelClosedY = 0;

function toggleMobilePanel(forceOpen = false) {
    if (window.innerWidth >= 768) return; 
    uiPanel.style.transitionDuration = ''; 
    const closedY = uiPanel.offsetHeight - 50; 
    if (!isMobilePanelOpen || forceOpen) {
        uiPanel.style.transform = 'translateY(0)'; 
        isMobilePanelOpen = true;
    } else {
        uiPanel.style.transform = `translateY(${closedY}px)`; 
        isMobilePanelOpen = false;
    }
}
window.toggleMobilePanel = toggleMobilePanel;

uiPanel.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768) return;
    if (e.target.closest('#mobile-handle') || e.target.closest('h1') || !isMobilePanelOpen) {
        isDraggingPanel = true;
        dragStartY = e.touches[0].clientY;
        panelClosedY = uiPanel.offsetHeight - 50;
        panelCurrentY = isMobilePanelOpen ? 0 : panelClosedY;
        uiPanel.style.transitionDuration = '0ms';
    }
}, {passive: true});

uiPanel.addEventListener('touchmove', (e) => {
    if (!isDraggingPanel) return;
    const deltaY = e.touches[0].clientY - dragStartY;
    let newY = panelCurrentY + deltaY;
    if (newY < 0) newY = 0;
    if (newY > panelClosedY) newY = panelClosedY;
    uiPanel.style.transform = `translateY(${newY}px)`;
}, {passive: true});

uiPanel.addEventListener('touchend', () => {
    if (!isDraggingPanel) return;
    isDraggingPanel = false;
    uiPanel.style.transitionDuration = '';
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(uiPanel).transform);
    if (matrix.m42 > (panelClosedY / 2)) {
        uiPanel.style.transform = `translateY(${panelClosedY}px)`;
        isMobilePanelOpen = false;
    } else {
        uiPanel.style.transform = 'translateY(0)';
        isMobilePanelOpen = true;
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
        uiPanel.style.transform = 'none';
        isMobilePanelOpen = true;
    } else if (!isMobilePanelOpen) {
        uiPanel.style.transform = `translateY(${uiPanel.offsetHeight - 50}px)`;
    }
});

function selectNode(data) {
    selectedNodeId = data.id;
    updateTree(); 

    document.getElementById('selected-info').classList.remove('hidden');
    
    let mainTxt = data.name;
    const childNum = getChildIndexLabel(data);
    if (childNum) mainTxt += ` (${childNum})`;
    if (data.mainAlm) mainTxt += " (Alm.)";
    
    document.getElementById('info-name').textContent = mainTxt;
    document.getElementById('info-detail').textContent = data.birthYear ? `Tahun Lahir: ${data.birthYear}` : 'Tahun lahir tidak tercatat';
    
    const tabsContainer = document.getElementById('spouse-tabs-container');
    tabsContainer.innerHTML = '';
    const spouses = data.spouses || [];
    
    if (spouses.length === 0) {
        document.getElementById('spouse-container-box').style.display = 'none';
        document.getElementById('spouse-info-box').style.display = 'none';
    } else {
        document.getElementById('spouse-container-box').style.display = 'block';
        document.getElementById('spouse-info-box').style.display = 'block';
        
        const activeIdx = activeSpouseIndices[data.id] || 0;
        spouses.forEach((sp, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `px-3.5 py-2 rounded-xl text-xs font-extrabold transition shadow-sm ${idx === activeIdx ? 'bg-blue-700 text-white shadow-md' : 'bg-white text-gray-800 border-2 border-gray-300 hover:bg-gray-100'}`;
            btn.textContent = `Istri ${idx + 1}: ${sp.name || 'Tanpa Nama'}`;
            btn.onclick = () => switchActiveSpouse(idx);
            tabsContainer.appendChild(btn);
        });

        updateSpouseInfoPanel(data, activeIdx);
    }
    
    toggleMobilePanel(true);
}

window.switchActiveSpouse = function(index) {
    if (!selectedNodeId) return;
    activeSpouseIndices[selectedNodeId] = parseInt(index);
    updateTree();
    const node = familyData.find(n => n.id === selectedNodeId);
    if (node) {
        selectNode(node); 
    }
};

function updateSpouseInfoPanel(node, idx) {
    const spouses = node.spouses || [];
    const sp = spouses[idx];
    if (!sp) return;

    let spouseTxt = sp.name;
    if (sp.spouseAlm) spouseTxt += " (Alm.)";
    document.getElementById('info-spouse-name').textContent = spouseTxt;
    document.getElementById('info-spouse-detail').textContent = sp.spouseBirthYear ? `Tahun Lahir: ${sp.spouseBirthYear}` : 'Tahun lahir tidak tercatat';
}

function openModal(action) {
    const modal = document.getElementById('member-modal');
    const title = document.getElementById('modal-title');
    
    document.getElementById('member-form').reset();
    document.getElementById('form-action').value = action;
    modal.style.display = 'flex';

    const mainSection = document.getElementById('main-person-section');
    const spouseSection = document.getElementById('spouse-section');
    const childSpouseSection = document.getElementById('child-spouse-section');
    const editSiblingSection = document.getElementById('edit-sibling-section');
    const nameInput = document.getElementById('name');
    const spouseNameInput = document.getElementById('spouseName');

    if (action === 'root') {
        title.textContent = 'Tambah Leluhur Utama';
        mainSection.style.display = 'block';
        spouseSection.style.display = 'block';
        childSpouseSection.style.display = 'none';
        editSiblingSection.style.display = 'none';
        nameInput.setAttribute('required', 'true');
    } else if (action === 'child') {
        const parentNode = familyData.find(n => n.id === selectedNodeId);
        title.textContent = `Tambah Anak dari ${parentNode.name}`;
        mainSection.style.display = 'block';
        spouseSection.style.display = 'block';
        childSpouseSection.style.display = 'block';
        editSiblingSection.style.display = 'none';
        nameInput.setAttribute('required', 'true');

        const childSpouseSelect = document.getElementById('childSpouseIndex');
        if (parentNode && parentNode.spouses && parentNode.spouses.length > 0) {
            childSpouseSelect.innerHTML = '';
            parentNode.spouses.forEach((sp, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `Istri ${idx + 1}: ${sp.name || 'Tanpa Nama'}`;
                if (idx === (activeSpouseIndices[parentNode.id] || 0)) opt.selected = true;
                childSpouseSelect.appendChild(opt);
            });
        } else {
            childSpouseSection.style.display = 'none';
        }
    } else if (action === 'add_spouse') {
        title.textContent = 'Tambah Pasangan / Istri Lain';
        mainSection.style.display = 'none'; 
        spouseSection.style.display = 'block';
        childSpouseSection.style.display = 'none';
        editSiblingSection.style.display = 'none';
        spouseNameInput.setAttribute('required', 'true');
    } else if (action === 'edit') {
        title.textContent = 'Ubah Data Keluarga';
        mainSection.style.display = 'block';
        spouseSection.style.display = 'block';
        childSpouseSection.style.display = 'none';
        nameInput.setAttribute('required', 'true');
        
        const node = familyData.find(n => n.id === selectedNodeId);
        nameInput.value = node.name || '';
        document.getElementById('mainAlm').checked = !!node.mainAlm;
        document.getElementById('birthYear').value = node.birthYear || '';
        
        if (node.parentId) {
            editSiblingSection.style.display = 'block';
            const mySpouseIdx = node.parentSpouseIndex !== undefined ? node.parentSpouseIndex : 0;
            const sameMotherSiblings = familyData.filter(n => {
                if (n.parentId !== node.parentId) return false;
                const sIdx = n.parentSpouseIndex !== undefined ? n.parentSpouseIndex : 0;
                return sIdx === mySpouseIdx;
            });
            const currentIdx = sameMotherSiblings.findIndex(n => n.id === node.id);
            document.getElementById('editSiblingPosition').value = currentIdx !== -1 ? currentIdx + 1 : 1;
        } else {
            editSiblingSection.style.display = 'none';
        }

        const activeIdx = activeSpouseIndices[node.id] || 0;
        const activeSpouse = node.spouses && node.spouses[activeIdx] ? node.spouses[activeIdx] : {};
        spouseNameInput.value = activeSpouse.name || '';
        document.getElementById('spouseAlm').checked = !!activeSpouse.spouseAlm;
        document.getElementById('spouseBirthYear').value = activeSpouse.spouseBirthYear || '';
    }
    setTimeout(() => {
        const focusEl = action === 'add_spouse' ? spouseNameInput : nameInput;
        if (focusEl) focusEl.focus();
    }, 100);
}
window.openModal = openModal;

function closeModal() {
    document.getElementById('member-modal').style.display = 'none';
}
window.closeModal = closeModal;

function handleFormSubmit(event) {
    event.preventDefault();
    const action = document.getElementById('form-action').value;
    const name = document.getElementById('name').value;
    const mainAlm = document.getElementById('mainAlm').checked;
    const birthYear = document.getElementById('birthYear').value;
    const spouseName = document.getElementById('spouseName').value;
    const spouseAlm = document.getElementById('spouseAlm').checked;
    const spouseBirthYear = document.getElementById('spouseBirthYear').value;

    const spouseObj = spouseName ? { name: spouseName, spouseAlm, spouseBirthYear } : null;

    if (action === 'root') {
        familyData.push({ 
            id: nextId.toString(), 
            parentId: null, 
            name, 
            mainAlm, 
            birthYear, 
            spouses: spouseObj ? [spouseObj] : [] 
        });
        selectNode(familyData[familyData.length - 1]); 
        nextId++;
    } 
    else if (action === 'child' && selectedNodeId) {
        const parentNode = familyData.find(n => n.id === selectedNodeId);
        const selectedSpouseIdx = document.getElementById('childSpouseIndex').value;

        familyData.push({ 
            id: nextId.toString(), 
            parentId: selectedNodeId, 
            parentSpouseIndex: parentNode && parentNode.spouses && parentNode.spouses.length > 0 ? parseInt(selectedSpouseIdx) : 0,
            name, 
            mainAlm, 
            birthYear, 
            spouses: spouseObj ? [spouseObj] : [] 
        });
        nextId++;
    }
    else if (action === 'add_spouse' && selectedNodeId) {
        const node = familyData.find(n => n.id === selectedNodeId);
        if (node) {
            if (!node.spouses) node.spouses = [];
            node.spouses.push(spouseObj);
            activeSpouseIndices[node.id] = node.spouses.length - 1;
            selectNode(node);
        }
    }
    else if (action === 'edit' && selectedNodeId) {
        const nodeIndex = familyData.findIndex(n => n.id === selectedNodeId);
        if (nodeIndex !== -1) {
            familyData[nodeIndex].name = name;
            familyData[nodeIndex].mainAlm = mainAlm;
            familyData[nodeIndex].birthYear = birthYear;
            
            if (!familyData[nodeIndex].spouses) familyData[nodeIndex].spouses = [];
            const activeIdx = activeSpouseIndices[selectedNodeId] || 0;
            if (spouseName) {
                if (familyData[nodeIndex].spouses[activeIdx]) {
                    familyData[nodeIndex].spouses[activeIdx] = { name: spouseName, spouseAlm, spouseBirthYear };
                } else {
                    familyData[nodeIndex].spouses.push({ name: spouseName, spouseAlm, spouseBirthYear });
                    activeSpouseIndices[selectedNodeId] = familyData[nodeIndex].spouses.length - 1;
                }
            } else if (familyData[nodeIndex].spouses[activeIdx]) {
                familyData[nodeIndex].spouses.splice(activeIdx, 1);
                activeSpouseIndices[selectedNodeId] = 0;
            }

            const node = familyData[nodeIndex];
            if (node.parentId) {
                const newPosInput = document.getElementById('editSiblingPosition').value;
                if (newPosInput) {
                    const targetPosition = parseInt(newPosInput) - 1;
                    const mySpouseIdx = node.parentSpouseIndex !== undefined ? node.parentSpouseIndex : 0;
                    
                    let allSiblings = familyData.filter(n => n.parentId === node.parentId);
                    let sameMotherSiblings = allSiblings.filter(n => {
                        const sIdx = n.parentSpouseIndex !== undefined ? n.parentSpouseIndex : 0;
                        return sIdx === mySpouseIdx;
                    });

                    const oldIndex = sameMotherSiblings.findIndex(n => n.id === node.id);
                    if (oldIndex !== -1 && targetPosition >= 0 && targetPosition < sameMotherSiblings.length && oldIndex !== targetPosition) {
                        const [movedItem] = sameMotherSiblings.splice(oldIndex, 1);
                        sameMotherSiblings.splice(targetPosition, 0, movedItem);

                        let otherData = familyData.filter(n => {
                            if (n.parentId !== node.parentId) return true;
                            const sIdx = n.parentSpouseIndex !== undefined ? n.parentSpouseIndex : 0;
                            return sIdx !== mySpouseIdx;
                        });
                        familyData = otherData;
                        familyData.push(...sameMotherSiblings); 
                    }
                }
            }
            selectNode(familyData[nodeIndex]); 
        }
    }

    closeModal();
    updateTree();
    syncToCloud(); 
    if(action === 'root') setTimeout(resetView, 100);
}
window.handleFormSubmit = handleFormSubmit;

function confirmDelete() {
    if (!selectedNodeId) return;
    const node = familyData.find(n => n.id === selectedNodeId);
    
    if(confirm(`Yakin ingin menghapus data "${node.name}" beserta seluruh keturunannya?`)) {
        const getDescendantIds = (parentId) => {
            let ids = [parentId];
            const children = familyData.filter(n => n.parentId === parentId);
            for (const child of children) ids = ids.concat(getDescendantIds(child.id));
            return ids;
        };

        const idsToDelete = getDescendantIds(selectedNodeId);
        familyData = familyData.filter(n => !idsToDelete.includes(n.id));

        if (isolatedParentId && idsToDelete.includes(isolatedParentId)) {
            resetFamilyFilter();
        }

        selectedNodeId = null;
        document.getElementById('selected-info').classList.add('hidden');
        updateTree();
        syncToCloud(); 
        showToast("Data berhasil dihapus");
    }
}
window.confirmDelete = confirmDelete;

function resetView() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const yOffset = window.innerWidth < 768 ? ch * 0.15 : 100;
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(cw / 2, yOffset).scale(1));
}
window.resetView = resetView;

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

function downloadTreeImage() {
    if (familyData.length === 0) return showToast("Belum ada data untuk diunduh!");
    showToast("Sedang memproses gambar...");
    const svgElement = document.querySelector('#tree-container svg');
    const gElement = svgElement.querySelector('g');
    const bbox = gElement.getBBox();
    const margin = 100, width = bbox.width + (margin * 2), height = bbox.height + (margin * 2);
    
    const clone = svgElement.cloneNode(true);
    clone.setAttribute('width', width); clone.setAttribute('height', height);
    clone.querySelector('g').setAttribute('transform', `translate(${-bbox.x + margin}, ${-bbox.y + margin})`);

    const styleEl = document.createElement('style');
    styleEl.textContent = `.link{fill:none;stroke:#64748b;stroke-width:3.5px}.text-main-name{font-weight:bold;font-size:14px;fill:#fff;text-anchor:middle;font-family:Arial,sans-serif}.text-spouse-name{font-weight:bold;font-size:14px;fill:#0f172a;text-anchor:middle;font-family:Arial,sans-serif}.text-main-detail{font-size:11px;fill:#eff6ff;text-anchor:middle;font-family:Arial,sans-serif}.text-spouse-detail{font-size:11px;fill:#475569;text-anchor:middle;font-family:Arial,sans-serif}.couple-link{stroke:#64748b;stroke-width:3.5px}`;
    clone.insertBefore(styleEl, clone.firstChild);

    const svgString = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const DOMURL = window.URL || window.webkitURL || window;
    const url = DOMURL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));

    img.onload = () => {
        const scale = 3, canvas = document.createElement('canvas');
        canvas.width = width * scale; canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
        
        const link = document.createElement('a');
        link.download = 'Silsilah_Keluarga.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        DOMURL.revokeObjectURL(url);
        showToast("Gambar berhasil diunduh!");
    };
    img.src = url;
}
window.downloadTreeImage = downloadTreeImage;

let db, auth, docRef;
window.initialViewDone = false;

async function initCloud() {
    const cloudStatus = document.getElementById('cloud-status');
    try {
        const firebaseConfig = {
            apiKey: "AIzaSyBLxKcMg9anSKgGiref3NQDdm9AZWta6xI",
            authDomain: "keluargaabadi016.firebaseapp.com",
            projectId: "keluargaabadi016",
            storageBucket: "keluargaabadi016.firebasestorage.app",
            messagingSenderId: "468992400632",
            appId: "1:468992400632:web:f70b711736f0c6510c2f0d"
        };

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-silsilah-id';
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app); db = getFirestore(app);
        
        const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        if (token) await signInWithCustomToken(auth, token);
        else await signInAnonymously(auth); 

        docRef = doc(db, 'artifacts', appId, 'public', 'data', 'familyTree', 'mainTree');

        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                familyData = docSnap.data().nodes || [];
                familyData.forEach(n => {
                    if (!n.spouses && n.spouseName) {
                        n.spouses = [{ name: n.spouseName, spouseAlm: n.spouseAlm, spouseBirthYear: n.spouseBirthYear }];
                    } else if (!n.spouses) {
                        n.spouses = [];
                    }
                });
                nextId = familyData.length > 0 ? Math.max(...familyData.map(n => parseInt(n.id))) + 1 : 1;
            } else familyData = [];
            
            updateTree(); 
            if(!window.initialViewDone && familyData.length > 0) {
                setTimeout(resetView, 300);
                window.initialViewDone = true;
            }
            if(cloudStatus) { cloudStatus.textContent = 'Cloud Aktif ☁️'; cloudStatus.className = 'text-xs bg-green-100 text-green-800 px-3 py-1 rounded-full font-bold shadow-sm'; }
        }, () => {
            if(cloudStatus) { cloudStatus.textContent = 'Terputus'; cloudStatus.className = 'text-xs bg-red-100 text-red-800 px-3 py-1 rounded-full font-bold'; }
        });
    } catch (error) {
        if(cloudStatus) cloudStatus.textContent = 'Gagal Koneksi';
    }
}

async function syncToCloud() {
    if (!auth || !auth.currentUser || !docRef) return;
    try { await setDoc(docRef, { nodes: familyData }); } 
    catch (error) { showToast("Gagal menyimpan ke cloud."); }
}

window.onload = initCloud;