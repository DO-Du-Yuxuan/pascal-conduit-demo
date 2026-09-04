import {projectSchema,nodeSchema,zoneNodeSchema,doorNodeSchema} from './schema'; import {Diagnostic,NodeData,Parsed} from '../types';
import { isSdiSpaceFunctionCode } from '../space-functions/sdi-space-functions';
export function parseProject(raw:unknown):Parsed {
  const d:Diagnostic[]=[]; const top=projectSchema.safeParse(raw);
  if(!top.success) return {nodes:{},raw,diagnostics:[{severity:'error',code:'missing_nodes',message:'顶层缺少有效的 nodes 对象',sourcePath:'nodes'}]};
  const nodes:Record<string,NodeData>={};
  for(const [id,value] of Object.entries(top.data.nodes)){
    const generic=nodeSchema.safeParse(value);
    if(!generic.success){d.push({severity:'error',code:'invalid_node',message:'节点不是可识别对象',nodeId:id,sourcePath:`nodes.${id}`});continue}
    const data:NodeData={...(generic.data as NodeData),id};
    if(data.type==='zone'){
      const zone=zoneNodeSchema.safeParse(value);
      if(!zone.success){delete data.spaceFunctionCode; d.push({severity:'warning',code:'invalid_space_function_code_type',message:'Zone.spaceFunctionCode 必须是字符串；该字段已忽略',nodeId:id,sourcePath:`nodes.${id}.spaceFunctionCode`});}
      else if(zone.data.spaceFunctionCode!==undefined&&!isSdiSpaceFunctionCode(zone.data.spaceFunctionCode)) d.push({severity:'warning',code:'unknown_space_function_code',message:`未知 SDI 空间功能编码：${zone.data.spaceFunctionCode}`,nodeId:id,sourcePath:`nodes.${id}.spaceFunctionCode`});
    } else if(data.type==='door'){
      const door=doorNodeSchema.safeParse(value);
      if(!door.success){delete data.isPrimaryEntrance; d.push({severity:'warning',code:'invalid_primary_entrance_type',message:'Door.isPrimaryEntrance 必须是 boolean；该字段已忽略',nodeId:id,sourcePath:`nodes.${id}.isPrimaryEntrance`});}
    }
    if(data.type!=='zone'&&Object.prototype.hasOwnProperty.call(data,'spaceFunctionCode')){delete data.spaceFunctionCode; d.push({severity:'warning',code:'space_function_code_on_non_zone',message:'spaceFunctionCode 仅适用于 Zone；非 Zone 节点上的该字段已忽略',nodeId:id,sourcePath:`nodes.${id}.spaceFunctionCode`});}
    if(data.type!=='door'&&Object.prototype.hasOwnProperty.call(data,'isPrimaryEntrance')){delete data.isPrimaryEntrance; d.push({severity:'warning',code:'primary_entrance_on_non_door',message:'isPrimaryEntrance 仅适用于 Door；非 Door 节点上的该字段已忽略',nodeId:id,sourcePath:`nodes.${id}.isPrimaryEntrance`});}
    nodes[id]=data;
  }
  return {nodes,raw,diagnostics:d};
}
